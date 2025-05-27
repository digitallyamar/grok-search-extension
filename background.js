// Remove existing context menu items to prevent duplicates
chrome.contextMenus.removeAll(() => {
  console.log("Context menus cleared and creating new ones");
  chrome.contextMenus.create({
    id: "search-with-grok",
    title: "Search with Grok: '%s'",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "summarize-with-grok",
    title: "Summarize Historical Context with Grok",
    contexts: ["all"]
  });
});

// Listen for context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  console.log("Context menu clicked:", info);
  if (info.menuItemId === "search-with-grok" && info.selectionText) {
    const selectedText = info.selectionText.trim();
    console.log("Selected text:", selectedText);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showPopup,
      args: [selectedText]
    }, (results) => {
      console.log("Script injection result:", results);
    });
  } else if (info.menuItemId === "summarize-with-grok") {
    chrome.storage.local.set({ summaryTabId: tab.id, pageUrl: info.pageUrl }, () => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageText
      }, (results) => {
        console.log("Text extraction result:", results);
        if (results && results[0] && results[0].result) {
          const pageText = results[0].result;
          const pageUrl = info.pageUrl;
          const prompt = `Provide the historical context for the topic discussed in this text and summarize it in 100–200 words: ${pageText}. For more details, refer to: ${pageUrl}`;
          console.log("Sending summary query to Grok, length:", prompt.length);
          chrome.storage.local.set({ grokQuery: prompt }, () => {
            chrome.tabs.create({ url: "https://grok.com" }, (newTab) => {
              if (chrome.runtime.lastError) {
                console.error("Failed to open Grok tab:", chrome.runtime.lastError.message);
                return;
              }
              console.log("Grok tab opened for summary, tab ID:", newTab.id);
              chrome.storage.local.set({ grokTabId: newTab.id });
            });
          });
        } else {
          console.error("Failed to extract page text");
        }
      });
    });
  }
});

// Listen for messages from content script
let lastSummary = '';
let lastProcessedTime = 0;
const debounceInterval = 2000; // 2 seconds

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received:", request);
  if (request.type === "searchGrok") {
    chrome.storage.local.set({ grokQuery: request.query }, () => {
      chrome.tabs.create({ url: "https://grok.com" }, () => {
        console.log("Grok tab opened");
      });
    });
  } else if (request.type === "summaryReceived") {
    console.log("Summary received:", request.summary);
    const currentTime = Date.now();

    // Deduplicate messages
    if (request.summary === lastSummary && currentTime - lastProcessedTime < debounceInterval) {
      console.log("Duplicate summary received, ignoring");
      return;
    }

    lastSummary = request.summary;
    lastProcessedTime = currentTime;

    // Validate and clean summary
    let cleanedSummary = request.summary;
    if (
      cleanedSummary === "Summary not found" ||
      cleanedSummary.length < 100 ||
      cleanedSummary.includes("Provide the historical context") ||
      cleanedSummary.includes("=>") ||
      cleanedSummary.includes("function(") ||
      cleanedSummary.includes("gtag(") ||
      cleanedSummary.includes("How can Grok help?") ||
      cleanedSummary.includes("DeepSearch") ||
      cleanedSummary.match(/^[A-Za-z]\s*Provide/)
    ) {
      console.warn("Invalid or no summary captured, skipping timeline");
      return;
    }

    // Clean header and normalize text
    cleanedSummary = cleanedSummary
      .replace(/^Historical Context and Summary\s*\((\d+)\s*words\):/, '')
      .replace(/\(.*words\)/, '')
      .replace(/–/g, '-') // Normalize en dash
      .replace(/\s+/g, ' ')
      .trim();
    console.log("Cleaned summary:", cleanedSummary);

    const events = extractEvents(cleanedSummary);
    console.log("Extracted events:", events);

    chrome.storage.local.set({ timelineEvents: events, pageUrl: request.pageUrl }, () => {
      console.log("Stored timelineEvents:", events, "pageUrl:", request.pageUrl);
      // Only open timeline if events are valid
      if (events.length > 0 && events[0].description !== "No historical context available." && events[0].description.length > 10) {
        setTimeout(() => {
          chrome.tabs.create({ url: chrome.runtime.getURL("timeline.html") }, (timelineTab) => {
            if (chrome.runtime.lastError) {
              console.error("Failed to open timeline tab:", chrome.runtime.lastError.message);
              return;
            }
            if (!timelineTab) {
              console.error("Timeline tab is undefined");
              return;
            }
            console.log("Timeline tab opened, ID:", timelineTab.id);
          });
        }, 10000); // 10 seconds
      } else {
        console.error("No valid events extracted, skipping timeline tab");
      }
    });
  } else if (request.type === "closeTimelineTab") {
    chrome.tabs.remove(sender.tab.id, () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to close timeline tab:", chrome.runtime.lastError.message);
      } else {
        console.log("Timeline tab closed");
      }
    });
  }
});

// Function to show popup (injected into page)
function showPopup(selectedText) {
  console.log("showPopup called with:", selectedText);
  const existingPopup = document.getElementById("grok-search-popup");
  if (existingPopup) {
    console.log("Removing existing popup");
    existingPopup.remove();
  }

  fetch(chrome.runtime.getURL("popup.html"))
    .then(response => {
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      return response.text();
    })
    .then(html => {
      const div = document.createElement("div");
      div.innerHTML = html;
      document.body.appendChild(div);
      console.log("Popup HTML injected");

      const popup = document.getElementById("grok-search-popup");
      if (popup) {
        console.log("Popup found in DOM");
      } else {
        console.error("Popup not found in DOM");
      }

      const selectedTextElement = document.getElementById("selected-text");
      if (selectedTextElement) {
        selectedTextElement.textContent = selectedText;
        console.log("Selected text set:", selectedText);
      } else {
        console.error("Selected text element not found");
      }

      const searchBtn = document.getElementById("search-btn");
      const extraTextInput = document.getElementById("extra-text");
      if (searchBtn && extraTextInput) {
        searchBtn.addEventListener("click", () => {
          const extraText = extraTextInput.value.trim();
          const query = extraText ? `${selectedText} ${extraText}` : selectedText;
          console.log("Search button clicked, query:", query);
          chrome.runtime.sendMessage({ type: "searchGrok", query });
          div.remove();
          console.log("Popup removed after search");
        });

        extraTextInput.addEventListener("keypress", (e) => {
          if (e.key === "Enter") {
            const extraText = extraTextInput.value.trim();
            const query = extraText ? `${selectedText} ${extraText}` : selectedText;
            console.log("Enter key pressed, query:", query);
            chrome.runtime.sendMessage({ type: "searchGrok", query });
            div.remove();
            console.log("Popup removed after Enter key");
          }
        });
      } else {
        console.error("Search button or input not found");
      }

      const cancelBtn = document.getElementById("cancel-btn");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => {
          console.log("Cancel button clicked");
          div.remove();
          console.log("Popup removed after cancel");
        });
      } else {
        console.error("Cancel button not found");
      }
    })
    .catch(error => {
      console.error("Failed to load popup.html:", error);
    });
}

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
  const sentences = summary.split(/[.?!;]\s+|\n+/).filter(s => s.trim().length >= 20);
  console.log("Split sentences:", sentences);
  const events = [];
  // Match four-digit years (1000–9999) and century references (e.g., "19th century")
  const dateRegex = /\b([1-9][0-9]{3})\b|\b(\d{1,2})(?:st|nd|rd|th)\s+century\b/i;
  let eventCount = 1;

  // Remove header if present
  const cleanedSummary = summary.replace(/Historical Context and Summary\s*\(\d+–\d+\s*words\):/, '').trim();
  const cleanedSentences = cleanedSummary.split(/[.?!;]\s+|\n+/).filter(s => s.trim().length >= 20);

  for (let sentence of cleanedSentences) {
    sentence = sentence.trim();
    if (sentence && events.length < 6 && sentence.match(/[.!?]/)) {
      // Skip chat history-like sentences
      if (sentence.match(/^(Today|Yesterday|\d+\s+hours\s+ago)/) || sentence.includes("Create New Chat")) {
        console.log("Skipping chat history sentence:", sentence);
        continue;
      }

      let date = `Event ${eventCount}`;
      let year = Infinity; // For sorting non-dated events
      const match = sentence.match(dateRegex);
      console.log("Processing sentence:", { sentence, detectedDate: match ? match[0] : 'none' });

      if (match) {
        if (match[1]) {
          // Four-digit year (e.g., 1554, 2024)
          date = match[1];
          year = parseInt(match[1]);
        } else if (match[2]) {
          // Century reference (e.g., "19th century")
          const century = parseInt(match[2]);
          // Approximate mid-century year (e.g., 19th century → 1850)
          year = (century - 1) * 100 + 50;
          date = `${match[2]}th century`;
        }
      }

      events.push({ date, description: sentence, year });
      if (!match) eventCount++;
    }
  }

  // Sort events by year (ascending), placing non-dated events first
  events.sort((a, b) => {
    if (a.year === Infinity && b.year === Infinity) return 0;
    if (a.year === Infinity) return -1; // Non-dated events come first
    if (b.year === Infinity) return 1;
    return a.year - b.year;
  });

  // Clean up year property after sorting
  events.forEach(event => delete event.year);

  if (events.length === 0) {
    console.warn("No valid events extracted, using summary as fallback");
    events.push({ date: "Summary", description: cleanedSummary.substring(0, 500) });
  }

  console.log("Final extracted events:", events);
  return events;
}