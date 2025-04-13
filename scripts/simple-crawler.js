#!/usr/bin/env node

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// Set of URLs that have already been processed to avoid duplicates
const processedUrls = new Set();
// Queue of URLs to process
const urlQueue = [];
// Output directory
const outputDir = './website_markdown';

/**
 * Converts a URL to a file path
 */
function urlToFilePath(urlString, baseDomain) {
  let relativePath = urlString.replace(baseDomain, '');
  
  // Handle root URL
  if (relativePath === '' || relativePath === '/') {
    return 'index.md';
  }
  
  // Remove trailing slash if present
  if (relativePath.endsWith('/')) {
    relativePath = relativePath.slice(0, -1);
  }
  
  // Remove URL parameters
  const filePath = relativePath.split('?')[0];
  
  // Create filename - simplistically replacing invalid characters
  let filename = filePath.replace(/[<>:"/\\|?*]/g, '_');
  
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
 */
function ensureDirectoryExists(filePath) {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

/**
 * Extracts the domain from a URL
 */
function getDomain(urlString) {
  const parsedUrl = new URL(urlString);
  return `${parsedUrl.protocol}//${parsedUrl.hostname}`;
}

/**
 * Extracts all internal links from a page
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
 * Enhanced HTML to Markdown conversion that preserves formatting
 */
function htmlToMarkdown(html, baseUrl) {
  const $ = cheerio.load(html);
  
  // Remove elements that are usually not needed
  $('script, style, iframe, .comments, .ads, .navigation, .intercom-interblocks-header, .intercom-interblocks-footer').remove();
  
  // Remove copyright notices and skip to content links
  $('a[href="#main-content"]').parent().remove();
  $('a[href="#main-content"]').remove();
  $('[class*="copyright"]').remove();
  $('.i18n-switcher').remove();
  $('.language-switcher').remove();
  
  // Get the page title
  const title = $('title').text() || 'Untitled Page';
  let markdown = `# ${title}\n\n`;
  
  // Flag to track if we've already seen the title in the content
  let titleAdded = true; // Start true since we've added it manually
  
  // Remove "Table of contents" sections
  $('nav.table-of-contents, .table-of-contents, .toc').remove();
  $(':contains("Table of contents")').each(function() {
    if ($(this).text().trim() === 'Table of contents') {
      $(this).remove();
    }
  });
  
  // Remove empty anchors and navigation elements
  $('a[id^="h_"]').remove();
  
  // Special handling for Intercom help center content
  if (baseUrl.includes('intercom.help')) {
    // Remove header, nav and footer elements which are common in Intercom pages
    $('header, nav, footer').remove();
    $('.header, .footer, .sidebar, .sidebar-container').remove();
    $('.intercom-namespace, .intercom-emoji-picker-emoji').remove();
    
    // Remove related articles section
    $('.related-articles, .article-footer, .article-footer-wrap').remove();
    
    // Remove author info and timestamps
    $('.article-meta, .article__meta, .article-author, .article-time, .avatar-container').remove();
    
    // Get the article title from meta tags first (most reliable)
    const metaTitle = $('meta[property="og:title"]').attr('content') || 
                      $('title').text() || 
                      'Untitled Page';
    
    let content = `# ${metaTitle.split('|')[0].trim()}\n\n`;
    
    // Try to extract description from meta tags
    const metaDescription = $('meta[property="og:description"]').attr('content') || 
                           $('meta[name="description"]').attr('content');
    
    if (metaDescription) {
      content += `${metaDescription.trim()}\n\n`;
    }
    
    // Look for Intercom's content structure in the HTML
    // Method 1: Try to find article blocks directly
    const articleBlocks = [];
    
    // Extract h1/h2 headings
    $('h1, h2, .intercom-interblocks-h1, .intercom-interblocks-h2, .intercom-interblocks-heading, .intercom-interblocks-subheading').each((i, elem) => {
      const level = $(elem).is('h1, .intercom-interblocks-h1, .intercom-interblocks-heading') ? 1 : 2;
      articleBlocks.push({
        type: 'heading',
        level: level,
        text: $(elem).text().trim()
      });
    });
    
    // Extract paragraphs
    $('.intercom-interblocks-paragraph, p').each((i, elem) => {
      // Skip empty paragraphs
      if ($(elem).text().trim() === '') return;
      
      articleBlocks.push({
        type: 'paragraph',
        text: $(elem).text().trim()
      });
    });
    
    // Extract lists
    $('.intercom-interblocks-unordered-list, .intercom-interblocks-ordered-list, ul, ol, .intercom-interblocks-unordered-nested-list, .intercom-interblocks-ordered-nested-list').each((i, elem) => {
      const isOrdered = $(elem).is('ol, .intercom-interblocks-ordered-list, .intercom-interblocks-ordered-nested-list');
      const items = [];
      
      $(elem).find('li').each((j, li) => {
        items.push($(li).text().trim());
      });
      
      if (items.length > 0) {
        articleBlocks.push({
          type: isOrdered ? 'ordered-list' : 'unordered-list',
          items: items
        });
      }
    });
    
    // Process the blocks into markdown
    if (articleBlocks.length > 0) {
      for (const block of articleBlocks) {
        switch (block.type) {
          case 'heading':
            content += `${'#'.repeat(block.level)} ${block.text}\n\n`;
            break;
          case 'paragraph':
            content += `${block.text}\n\n`;
            break;
          case 'unordered-list':
            block.items.forEach(item => {
              content += `* ${item}\n`;
            });
            content += '\n';
            break;
          case 'ordered-list':
            block.items.forEach((item, index) => {
              content += `${index + 1}. ${item}\n`;
            });
            content += '\n';
            break;
        }
      }
      
      return content;
    }

    // Method 2: Try to directly extract HTML content and convert it
    const $articleContent = $('.article__content, .article_body, .intercom-article-body, div[class*="article"]').first();
    if ($articleContent.length > 0) {
      return content + extractTextContent($articleContent);
    }
    
    // Method 3: As a last resort, try to get all textual content
    function extractTextContent(element) {
      let text = '';
      
      // Check if this is a heading element
      if (element.is('h1, h2, h3, h4, h5, h6')) {
        const level = parseInt(element.prop('tagName').charAt(1));
        return `${'#'.repeat(level)} ${element.text().trim()}\n\n`;
      }
      
      // Check if this is a paragraph
      if (element.is('p')) {
        return `${element.text().trim()}\n\n`;
      }
      
      // Check if this is a list
      if (element.is('ul, ol')) {
        const items = [];
        element.find('li').each((i, li) => {
          items.push($(li).text().trim());
        });
        
        if (element.is('ol')) {
          return items.map((item, index) => `${index + 1}. ${item}`).join('\n') + '\n\n';
        } else {
          return items.map(item => `* ${item}`).join('\n') + '\n\n';
        }
      }
      
      // Recursively process children
      element.contents().each((i, child) => {
        if (child.type === 'text') {
          const trimmed = $(child).text().trim();
          if (trimmed) {
            text += trimmed + ' ';
          }
        } else if (child.type === 'tag') {
          text += extractTextContent($(child));
        }
      });
      
      return text;
    }
    
    // If we get here, use a more generic approach to extract all content from the body
    return content + extractTextContent($('body'));
  }
  
  // Process content by element type to maintain structure
  function processNode(node) {
    if (!node) return '';
    
    // Process different element types
    if (node.type === 'text') {
      // Trim and remove excessive whitespace
      const text = node.data.trim().replace(/\s+/g, ' ');
      return text;
    }
    
    if (node.type !== 'tag') {
      return '';
    }
    
    const tagName = node.name.toLowerCase();
    
    // Skip processing certain elements
    if (['script', 'style', 'nav', 'header', 'footer'].includes(tagName)) {
      return '';
    }
    
    // Process children elements
    const children = $(node).contents().toArray();
    const childContent = children.map(processNode).join('').trim();
    
    // Skip empty elements
    if (!childContent && !['img', 'hr', 'br'].includes(tagName)) {
      return '';
    }
    
    switch (tagName) {
      // Headings
      case 'h1':
        // Check if this heading is the same as the page title
        if (childContent === title && titleAdded) {
          return ''; // Skip duplicate title
        }
        titleAdded = true;
        return `\n# ${childContent}\n\n`;
      case 'h2':
        return `\n## ${childContent}\n\n`;
      case 'h3':
        return `\n### ${childContent}\n\n`;
      case 'h4':
        return `\n#### ${childContent}\n\n`;
      case 'h5':
        return `\n##### ${childContent}\n\n`;
      case 'h6':
        return `\n###### ${childContent}\n\n`;
      
      // Paragraphs and text formatting
      case 'p':
        if (!childContent) return '';
        return `\n${childContent}\n\n`;
      case 'strong':
      case 'b':
        return `**${childContent}**`;
      case 'em':
      case 'i':
        return `*${childContent}*`;
      case 'code':
        return `\`${childContent}\``;
      case 'pre':
        return `\n\`\`\`\n${childContent}\n\`\`\`\n\n`;
      
      // Lists
      case 'ul':
        if (!childContent) return '';
        let ulContent = '\n';
        $(node).children('li').each((i, li) => {
          const liContent = processNode(li).trim();
          if (liContent) {
            ulContent += `* ${liContent}\n`;
          }
        });
        return ulContent + '\n';
      case 'ol':
        if (!childContent) return '';
        let olContent = '\n';
        $(node).children('li').each((i, li) => {
          const liContent = processNode(li).trim();
          if (liContent) {
            olContent += `${i+1}. ${liContent}\n`;
          }
        });
        return olContent + '\n';
      case 'li':
        return childContent;
      
      // Links and images
      case 'a':
        const href = $(node).attr('href');
        if (!childContent || !href) return childContent;
        // Fix relative links to absolute
        if (href.startsWith('/')) {
          const baseDomainUrl = getDomain(baseUrl);
          return `[${childContent}](${baseDomainUrl}${href})`;
        }
        return `[${childContent}](${href})`;
      case 'img':
        const src = $(node).attr('src');
        const alt = $(node).attr('alt') || '';
        if (src) {
          return `![${alt}](${src})`;
        }
        return '';
      
      // Tables
      case 'table':
        let tableContent = '\n';
        
        // Process header row
        const headerRow = $(node).find('thead tr').first();
        if (headerRow.length) {
          tableContent += '| ' + $(headerRow).find('th, td').map((i, cell) => $(cell).text().trim()).get().join(' | ') + ' |\n';
          tableContent += '| ' + $(headerRow).find('th, td').map(() => '---').get().join(' | ') + ' |\n';
        }
        
        // Process table body
        $(node).find('tbody tr').each((i, row) => {
          tableContent += '| ' + $(row).find('td').map((j, cell) => $(cell).text().trim()).get().join(' | ') + ' |\n';
        });
        
        return tableContent + '\n';
      
      // Line break
      case 'br':
        return '\n';
      
      // Blockquote
      case 'blockquote':
        if (!childContent) return '';
        return `\n> ${childContent.split('\n').join('\n> ')}\n\n`;
      
      // Horizontal rule
      case 'hr':
        return '\n---\n\n';
      
      // Div and other block elements
      case 'div':
      case 'section':
      case 'article':
        if (!childContent) return '';
        return `\n${childContent}\n`;
      
      // Default handling
      default:
        return childContent;
    }
  }
  
  // Process the main content, prioritizing article or main tags if they exist
  const mainContent = $('article').first()[0] || $('main').first()[0] || $('body')[0];
  
  if (mainContent) {
    // Process content directly instead of relying on the node structure
    // First try to extract what appears to be the main content area
    const $mainContent = $(mainContent);
    
    // If we're processing the body, try to extract the most likely content container
    if (mainContent.name === 'body') {
      // Look for common content container classes/IDs
      const contentSelectors = [
        'article', 'main', '.content', '#content', '.main-content', '#main-content',
        '.post-content', '.entry-content', '.page-content', '.article-content'
      ];
      
      for (const selector of contentSelectors) {
        const $potentialContent = $(selector);
        if ($potentialContent.length > 0) {
          // Process this element instead
          markdown += processNode($potentialContent[0]);
          return markdown
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+\n/g, '\n')
            .trim();
        }
      }
      
      // If no content container found, process all direct children of body
      // that are likely to contain content (skip obvious navigation, header, footer elements)
      const skipElements = ['header', 'footer', 'nav', 'style', 'script', 'noscript'];
      $mainContent.children().each((_, child) => {
        const tagName = child.name.toLowerCase();
        if (!skipElements.includes(tagName)) {
          markdown += processNode(child);
        }
      });
    } else {
      markdown += processNode(mainContent);
    }
  } else {
    // Fallback to just getting text
    markdown += $('body').text().trim();
  }
  
  // Clean up excessive newlines and spaces
  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+\n/g, '\n')
    .trim();
}

/**
 * Fetches and processes a URL
 */
async function processUrl(urlToProcess, baseDomain) {
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
    
    // Special handling for Intercom help pages
    if (urlToProcess.includes('intercom.help') && urlToProcess.includes('/articles/')) {
      // Try to extract content from JSON data embedded in the page
      let markdown = extractIntercomContent(html, urlToProcess);
      if (markdown) {
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
        return;
      }
    }
    
    // Regular processing for other pages
    // Convert HTML to Markdown
    let markdown = htmlToMarkdown(html, urlToProcess);
    
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
 * Extracts content from Intercom's article HTML
 */
function extractIntercomContent(html, url) {
  try {
    // First try with JSON extraction (keeping previous approach as fallback)
    const articleContentMatch = html.match(/"articleContent"\s*:\s*({[^}]*"blocks"\s*:\s*\[[^\]]*\][^}]*})/);
    if (articleContentMatch && articleContentMatch[1]) {
      // Clean up the JSON string to make it parseable
      let jsonStr = articleContentMatch[1].replace(/\\"/g, '"');
      
      // Handle nested quotes properly
      jsonStr = jsonStr.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => {
        return match.replace(/\\n/g, '\\\\n').replace(/\\t/g, '\\\\t');
      });
      
      // Add quotes to keys without quotes
      jsonStr = jsonStr.replace(/(\s*?)(\w+?)\s*?:/g, '"$2":');
      
      // Fix any remaining issues with the JSON
      jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      
      try {
        const articleData = JSON.parse(jsonStr);
        
        // Extract the article title
        let markdown = `# ${articleData.title || 'Untitled'}\n\n`;
        
        // Add the description if available
        if (articleData.description) {
          markdown += `${articleData.description}\n\n`;
        }
        
        // Process blocks
        if (articleData.blocks && Array.isArray(articleData.blocks)) {
          articleData.blocks.forEach(block => {
            switch (block.type) {
              case 'heading':
              case 'h1':
                markdown += `# ${block.text || ''}\n\n`;
                break;
              case 'subheading':
              case 'h2':
                markdown += `## ${block.text || ''}\n\n`;
                break;
              case 'h3':
                markdown += `### ${block.text || ''}\n\n`;
                break;
              case 'paragraph':
                if (block.text) {
                  markdown += `${block.text}\n\n`;
                }
                break;
              case 'unorderedNestedList':
              case 'unorderedList':
                if (block.items && Array.isArray(block.items)) {
                  block.items.forEach(item => {
                    if (typeof item === 'string') {
                      markdown += `* ${item}\n`;
                    } else if (item.content && Array.isArray(item.content)) {
                      item.content.forEach(content => {
                        if (content.text) {
                          markdown += `* ${content.text}\n`;
                        }
                      });
                    }
                  });
                  markdown += '\n';
                }
                break;
              case 'orderedNestedList':
              case 'orderedList':
                if (block.items && Array.isArray(block.items)) {
                  block.items.forEach((item, index) => {
                    if (typeof item === 'string') {
                      markdown += `${index + 1}. ${item}\n`;
                    } else if (item.content && Array.isArray(item.content)) {
                      item.content.forEach(content => {
                        if (content.text) {
                          markdown += `${index + 1}. ${content.text}\n`;
                        }
                      });
                    }
                  });
                  markdown += '\n';
                }
                break;
            }
          });
        }
        
        return markdown;
      } catch (jsonError) {
        console.error(`Error parsing JSON from ${url}: ${jsonError.message}`);
      }
    }
    
    // If JSON extraction failed, try direct HTML extraction
    // Get the title
    const titleMatch = html.match(/<h1[^>]*class="[^"]*"[^>]*>(.*?)<\/h1>/s) || 
                      html.match(/<title[^>]*>(.*?)\s*\|.*?<\/title>/s);
    
    let title = titleMatch ? titleMatch[1].trim() : 'Untitled';
    title = title.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    
    // Get the description
    const descMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]*)"/) ||
                     html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"/) ||
                     html.match(/<div[^>]*class="[^"]*text-body-secondary-color[^"]*"[^>]*><p>([^<]*)<\/p>/);
    
    let description = descMatch ? descMatch[1].trim() : '';
    description = description.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    
    let markdown = `# ${title}\n\n`;
    if (description) {
      markdown += `${description}\n\n`;
    }
    
    // Extract the main article content
    let articleContent = '';
    
    // Look for article sections
    const articleSectionMatch = html.match(/<div[^>]*class="[^"]*article_body[^"]*"[^>]*>(.*?)<\/div>\s*<div[^>]*class="[^"]*intercom-reaction/s);
    if (articleSectionMatch && articleSectionMatch[1]) {
      let articleHtml = articleSectionMatch[1];
      
      // Extract all headings (h2, h3, etc)
      const headingMatches = articleHtml.matchAll(/<h([2-6])[^>]*id="([^"]*)"[^>]*>(.*?)<\/h\1>/gs);
      for (const match of headingMatches) {
        const level = match[1];
        const text = match[3].replace(/<[^>]*>/g, '').trim();
        articleContent += `${'#'.repeat(parseInt(level))} ${text}\n\n`;
      }
      
      // Extract paragraphs
      const paragraphMatches = articleHtml.matchAll(/<div[^>]*class="[^"]*intercom-interblocks-paragraph[^"]*"[^>]*>.*?<p>(.*?)<\/p>.*?<\/div>/gs);
      for (const match of paragraphMatches) {
        const text = match[1].replace(/<[^>]*>/g, '').trim();
        if (text) {
          articleContent += `${text}\n\n`;
        }
      }
      
      // Extract lists
      const listMatches = articleHtml.matchAll(/<div[^>]*class="[^"]*intercom-interblocks-(unordered|ordered)[^"]*"[^>]*>.*?<(ul|ol)>(.*?)<\/(ul|ol)>.*?<\/div>/gs);
      for (const match of listMatches) {
        const isOrdered = match[1] === 'ordered' || match[2] === 'ol';
        const listHtml = match[3];
        
        // Extract list items
        const itemMatches = listHtml.matchAll(/<li>(.*?)<\/li>/gs);
        let itemIndex = 1;
        for (const itemMatch of itemMatches) {
          const text = itemMatch[1].replace(/<[^>]*>/g, '').trim();
          if (text) {
            if (isOrdered) {
              articleContent += `${itemIndex++}. ${text}\n`;
            } else {
              articleContent += `* ${text}\n`;
            }
          }
        }
        articleContent += '\n';
      }
    }
    
    // If we couldn't find structured content, try a more aggressive approach
    if (!articleContent) {
      // Just extract all paragraph-like content
      const allParagraphs = html.matchAll(/<p[^>]*>(.*?)<\/p>/gs);
      for (const match of allParagraphs) {
        const text = match[1].replace(/<[^>]*>/g, '').trim();
        if (text && text.length > 20 && !text.includes('Table of contents')) {
          articleContent += `${text}\n\n`;
        }
      }
      
      // Extract all lists
      const allLists = html.matchAll(/<(ul|ol)[^>]*>(.*?)<\/\1>/gs);
      for (const match of allLists) {
        const isOrdered = match[1] === 'ol';
        const listHtml = match[2];
        
        // Extract list items
        const itemMatches = listHtml.matchAll(/<li[^>]*>(.*?)<\/li>/gs);
        let itemIndex = 1;
        for (const itemMatch of itemMatches) {
          const text = itemMatch[1].replace(/<[^>]*>/g, '').trim();
          if (text) {
            if (isOrdered) {
              articleContent += `${itemIndex++}. ${text}\n`;
            } else {
              articleContent += `* ${text}\n`;
            }
          }
        }
        articleContent += '\n';
      }
    }
    
    if (articleContent) {
      // Fix common HTML entities
      articleContent = articleContent.replace(/&lt;/g, '<')
                                    .replace(/&gt;/g, '>')
                                    .replace(/&amp;/g, '&')
                                    .replace(/&nbsp;/g, ' ');
                                    
      markdown += articleContent;
      return markdown;
    }
    
  } catch (error) {
    console.error(`Error extracting Intercom content from ${url}: ${error.message}`);
  }
  
  return null;
}

/**
 * Main function to start the crawling process
 */
async function crawlWebsite(rootUrl) {
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
    await processUrl(url, baseDomain);
    
    // Add a small delay to avoid overwhelming the server
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('Crawling completed!');
  console.log(`Processed ${processedUrls.size} pages.`);
  console.log(`Markdown files are saved in the ${outputDir} directory.`);
}

// Check if a URL was provided as a command line argument
if (process.argv.length < 3) {
  console.log('Usage: node simple-crawler.js <root-url>');
  process.exit(1);
}

const rootUrl = process.argv[2];
console.log(`Starting to crawl: ${rootUrl}`);
crawlWebsite(rootUrl).catch(error => {
  console.error('An error occurred:', error);
  process.exit(1);
}); 