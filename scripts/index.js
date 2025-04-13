#!/usr/bin/env node

const axios = require('axios');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const fs = require('fs');
const path = require('path');
const url = require('url');
const sanitize = require('sanitize-filename');

// Initialize the HTML to Markdown converter
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '*'
});

// Set of URLs that have already been processed to avoid duplicates
const processedUrls = new Set();
// Queue of URLs to process
const urlQueue = [];

/**
 * Extracts the domain from a URL
 * @param {string} urlString - The URL to extract the domain from
 * @returns {string} The domain of the URL
 */
function getDomain(urlString) {
  const parsedUrl = new URL(urlString);
  return `${parsedUrl.protocol}//${parsedUrl.hostname}`;
}

/**
 * Converts a URL to a file path
 * @param {string} urlString - The URL to convert
 * @param {string} baseDomain - The base domain of the website
 * @returns {string} The file path for the URL
 */
function urlToFilePath(urlString, baseDomain) {
  let parsedUrl = new URL(urlString);
  let relativePath = urlString.replace(baseDomain, '');
  
  // Handle root URL
  if (relativePath === '' || relativePath === '/') {
    return 'index.md';
  }
  
  // Remove trailing slash if present
  if (relativePath.endsWith('/')) {
    relativePath = relativePath.slice(0, -1);
  }
  
  // Handle URL parameters
  const filePath = relativePath.split('?')[0];
  
  // Create a valid filename
  let filename = sanitize(filePath);
  
  // Ensure the filename ends with .md
  if (!filename.endsWith('.md')) {
    if (filename.endsWith('/') || filename === '') {
      filename += 'index.md';
    } else {
      filename += '.md';
    }
  }
  
  // Replace any remaining slashes with directory separators
  return filename.replace(/\//g, path.sep);
}

/**
 * Creates necessary directories for a file path
 * @param {string} filePath - The file path to create directories for
 */
function ensureDirectoryExists(filePath) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

/**
 * Extracts all internal links from a page
 * @param {string} html - The HTML content of the page
 * @param {string} baseUrl - The base URL of the page
 * @param {string} domain - The domain of the website
 * @returns {string[]} An array of internal URLs
 */
function extractInternalLinks(html, baseUrl, domain) {
  const $ = cheerio.load(html);
  const links = new Set();
  
  $('a').each((_, element) => {
    const href = $(element).attr('href');
    if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
      try {
        // Resolve relative URLs
        const absoluteUrl = new URL(href, baseUrl).href;
        
        // Only include URLs from the same domain
        if (absoluteUrl.startsWith(domain)) {
          links.add(absoluteUrl);
        }
      } catch (error) {
        console.warn(`Could not parse URL: ${href}`);
      }
    }
  });
  
  return Array.from(links);
}

/**
 * Fetches and processes a URL
 * @param {string} urlToProcess - The URL to process
 * @param {string} outputDir - The directory to save the markdown files to
 * @param {string} baseDomain - The base domain of the website
 */
async function processUrl(urlToProcess, outputDir, baseDomain) {
  if (processedUrls.has(urlToProcess)) {
    return;
  }
  
  processedUrls.add(urlToProcess);
  console.log(`Processing: ${urlToProcess}`);
  
  try {
    // Fetch the page
    const response = await axios.get(urlToProcess, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const html = response.data;
    const $ = cheerio.load(html);
    
    // Remove elements that are usually not needed in markdown
    $('script, style, iframe, nav, footer, .comments, .ads').remove();
    
    // Get the page title
    const title = $('title').text() || 'Untitled Page';
    
    // Convert HTML to Markdown
    let markdown = turndownService.turndown($.html('body'));
    
    // Add the title as a heading
    markdown = `# ${title}\n\n${markdown}`;
    
    // Save to a file
    const filePath = path.join(outputDir, urlToFilePath(urlToProcess, baseDomain));
    ensureDirectoryExists(filePath);
    fs.writeFileSync(filePath, markdown);
    
    console.log(`Saved: ${filePath}`);
    
    // Extract links and add them to the queue
    const links = extractInternalLinks(html, urlToProcess, baseDomain);
    for (const link of links) {
      if (!processedUrls.has(link)) {
        urlQueue.push(link);
      }
    }
  } catch (error) {
    console.error(`Error processing ${urlToProcess}: ${error.message}`);
  }
}

/**
 * Main function to start the crawling process
 * @param {string} rootUrl - The root URL to start crawling from
 */
async function crawlWebsite(rootUrl) {
  const outputDir = './website_markdown';
  
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  
  const baseDomain = getDomain(rootUrl);
  
  // Start with the root URL
  urlQueue.push(rootUrl);
  
  // Process the queue
  while (urlQueue.length > 0) {
    const url = urlQueue.shift();
    await processUrl(url, outputDir, baseDomain);
    
    // Add a small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('Crawling completed!');
  console.log(`Processed ${processedUrls.size} pages.`);
  console.log(`Markdown files are saved in the ${outputDir} directory.`);
}

// Check if a URL was provided as a command line argument
if (process.argv.length < 3) {
  console.log('Usage: node index.js <root-url>');
  process.exit(1);
}

const rootUrl = process.argv[2];
console.log(`Starting to crawl: ${rootUrl}`);
crawlWebsite(rootUrl).catch(error => {
  console.error('An error occurred:', error);
  process.exit(1);
});
