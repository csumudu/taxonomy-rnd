// Simple test to verify modules are loading
console.log('Starting module test...');

try {
  const axios = require('axios');
  console.log('Axios loaded successfully');
} catch (error) {
  console.error('Failed to load axios:', error.message);
}

try {
  const cheerio = require('cheerio');
  console.log('Cheerio loaded successfully');
} catch (error) {
  console.error('Failed to load cheerio:', error.message);
}

try {
  const TurndownService = require('turndown');
  console.log('Turndown loaded successfully');
} catch (error) {
  console.error('Failed to load turndown:', error.message);
}

try {
  const sanitize = require('sanitize-filename');
  console.log('Sanitize-filename loaded successfully');
} catch (error) {
  console.error('Failed to load sanitize-filename:', error.message);
}

console.log('Module test complete.'); 