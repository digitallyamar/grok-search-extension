// background.js
let lastSummary = '';
let lastClickTime = 0;
const debounceDelay = 500; // 500ms debounce

// Clear and create context menu
function setupContextMenu() {
  chrome.contextMenus.removeAll(() => {
    console.log("Context menus cleared and creating new ones");
    chrome.contextMenus.create({
      id: "summarize-with-grok",
      title: "Summarize Historical Context with Grok",
      contexts: ["all"]
    });
  });
}

// Initialize context menu on install or startup
chrome.runtime.onInstalled.addListener(setupContextMenu);
chrome.runtime.onStartup.addListener(setupContextMenu);

// Handle context menu click with debouncing
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "summarize-with-grok") {
    const now = Date.now();
    if (now - lastClickTime < debounceDelay) {
      console.log("Debouncing context menu click, ignoring");
      return;
    }
    lastClickTime = now;
    console.log("Context menu clicked:", info);

    if (!tab.id) {
      console.error("No valid tab ID");
      return;
    }

    // Extract page text
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageText
    }, (results) => {
      if (chrome.runtime.lastError) {
        console.error("Script execution error:", chrome.runtime.lastError);
        return;
      }
      console.log("Text extraction result:", results);
      if (results && results[0] && results[0].result) {
        const pageText = results[0].result;
        const query = `Provide the historical context for the following content in 100–200 words, formatted as a summary with a header "Historical Context and Summary":\n\n${pageText}`;
        console.log("Sending summary query to Grok, length:", query.length);

        // Open Grok tab
        chrome.tabs.create({ url: "https://grok.com" }, (grokTab) => {
          console.log("Grok tab opened for summary, tab ID:", grokTab.id);
          chrome.storage.local.set({
            grokQuery: query,
            grokTabId: grokTab.id,
            pageUrl: info.pageUrl
          });
        });
      } else {
        console.error("No text extracted");
      }
    });
  }
});

// Function to extract webpage text
function extractPageText() {
  let pageText = document.body.innerText || '';
  if (pageText.length > 4500) {
    pageText = pageText.substring(0, 4500) + '...';
  }
  pageText = pageText.replace(/\s+/g, ' ').trim();
  return pageText;
}

// Function to extract events from summary
function extractEvents(summary) {
  const headerRegex = /Historical Context and Summary(?:\s*of\s*\w+)?\s*(?:\([^)]+\))?\s*:/i;
  const cleanedSummary = summary.replace(headerRegex, '').trim();
  console.log("Cleaned summary:", cleanedSummary);
  // Improved regex to avoid splitting on abbreviations like "U.S."
  const sentences = cleanedSummary
    .split(/(?<=[.!?])\s+(?![A-Z]\.\s|[0-9]+\.[0-9]+|[eg]\.\s*\(|[,;])/i)
    .map(s => s.trim())
    .filter(s => s.length >= 30 && s.match(/[.!?]$/));
  console.log("Split sentences:", sentences);
  const datedEvents = [];
  const nonDatedEvents = [];
  const dateRegex = /(?:\b|[^0-9])([1-9][0-9]{3})(?:\s*BC)?(?:\b|[^0-9])|(mid-)?(\d{1,2})(?:st|nd|rd|th)\s+century(?:\s+to\s+\d{1,2}(?:st|nd|rd|th)\s+century)?\b|([1-9][0-9]{3})\s*(?:IBGE|survey|study)|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+([1-9][0-9]{3})/gi;
  let eventCount = 1;

  for (let sentence of sentences) {
    if (sentence.match(/(202[5-9])/)) {
      console.log("Skipping future-year sentence:", sentence);
      continue;
    }

    const matches = sentence.matchAll(dateRegex);
    let earliestYear = Infinity;
    let selectedDate = null;

    for (const match of matches) {
      let year = Infinity;
      let date = null;
      if (match[1]) {
        const yearNum = parseInt(match[1]);
        if (yearNum >= 1000 && yearNum <= 2024) {
          date = match[1];
          year = yearNum;
        }
      } else if (match[2] || match[3]) {
        const century = parseInt(match[3]);
        year = (century - 1) * 100 + 50;
        date = match[2] ? `mid-${match[3]}th century` : `${match[3]}th century`;
      } else if (match[4]) {
        const yearNum = parseInt(match[4]);
        if (yearNum >= 1000 && yearNum <= 2024) {
          date = match[4];
          year = yearNum;
        }
      } else if (match[5]) {
        const yearNum = parseInt(match[5]);
        if (yearNum >= 1000 && yearNum <= 2024) {
          date = match[5];
          year = yearNum;
        }
      }
      if (year < earliestYear && date) {
        earliestYear = year;
        selectedDate = date;
      }
    }

    const score = selectedDate ? 0 : sentence.length + (sentence.match(/\b(culture|community|influence|religion|cuisine|identity|commerce)\b/gi)?.length || 0) * 20;

    if (selectedDate) {
      datedEvents.push({ date: selectedDate, description: sentence, year: earliestYear });
    } else {
      nonDatedEvents.push({ date: `Event ${eventCount}`, description: sentence, year: Infinity, score });
      eventCount++;
    }

    console.log("Processing sentence:", { sentence, detectedDate: selectedDate || 'none', year: earliestYear, score });
  }

  nonDatedEvents.sort((a, b) => b.score - a.score);

  const events = [];
  const seenYears = new Set();
  const seenSentences = new Set();
  for (const event of datedEvents) {
    const key = `${event.year}:${event.description}`;
    if (!seenYears.has(event.year) && !seenSentences.has(event.description)) {
      events.push(event);
      seenYears.add(event.year);
      seenSentences.add(event.description);
    }
  }
  events.splice(5);
  const remainingSlots = 7 - events.length;
  if (remainingSlots > 0) {
    let nonDatedCount = 1;
    for (const event of nonDatedEvents.slice(0, remainingSlots)) {
      event.date = `Event ${nonDatedCount}`;
      nonDatedCount++;
      events.push(event);
    }
  }

  events.sort((a, b) => {
    if (a.year === Infinity && b.year === Infinity) return 0;
    if (a.year === Infinity) return 1;
    if (b.year === Infinity) return -1;
    return a.year - b.year;
  });

  events.forEach(event => {
    delete event.year;
    delete event.score;
  });

  if (events.length === 0) {
    console.warn("No valid events extracted, using summary as fallback");
    events.push({ date: "Summary", description: cleanedSummary.substring(0, 500) });
  }

  console.log("Final extracted events:", events);
  return events;
}

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'summaryReceived') {
    const headerRegex = /Historical Context and Summary(?:\s*of\s*\w+)?\s*(?:\([^)]+\))?\s*:/i;
    const cleanedSummary = message.summary.replace(headerRegex, '').trim();
    console.log("Summary received:", cleanedSummary);
    if (cleanedSummary === lastSummary) {
      console.log("Duplicate summary received, ignoring");
      return;
    }
    lastSummary = cleanedSummary;
    const events = extractEvents(cleanedSummary);
    chrome.storage.local.set({ timelineEvents: events, pageUrl: message.pageUrl }, () => {
      console.log("Stored timelineEvents:", events, "pageUrl:", message.pageUrl);
      chrome.tabs.create({ url: 'timeline.html' }, (tab) => {
        console.log("Timeline tab opened, ID:", tab.id);
      });
    });
  } else if (message.type === 'closeTimelineTab') {
    console.log("Timeline tab closed");
  }
});