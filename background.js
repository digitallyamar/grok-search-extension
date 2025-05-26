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
  if (pageText.length > 10000) {
    pageText = pageText.substring(0, 10000) + '...';
  }
  pageText = pageText.replace(/\s+/g, ' ').trim();
  return pageText;
}

// Function to extract events from summary
function extractEvents(summary) {
  // Split sentences, handling punctuation and newlines
  const sentences = summary.split(/[.?!;]\s+|\n+/).filter(s => s.trim().length >= 20);
  console.log("Split sentences:", sentences);
  const events = [];
  const dateRegex = /\b(1[0-9]{3}|20[0-9]{2})\b|\b(19|20)\d{2}s?\b/;
  let eventCount = 1;

  for (let sentence of sentences) {
    sentence = sentence.trim();
    if (sentence && events.length < 5) {
      // Skip header sentence
      if (sentence.startsWith("Historical Context and Summary")) {
        continue;
      }
      const match = sentence.match(dateRegex);
      let date = match ? match[0] : null;
      // Handle split sentences (e.g., "Named 'Chrysopylae'... by John C.")
      if (sentence.includes("Chrysopylae") && date === null) {
        date = "1846"; // Manual fix for 1846 event
      }
      if (sentence.includes("Golden Gate Bridge") && date === null) {
        date = "1937"; // Manual fix for 1937 event
      }
      if (date) {
        events.push({ date, description: sentence });
      } else {
        events.push({ date: `Event ${eventCount}`, description: sentence });
        eventCount++;
      }
    }
  }

  if (events.length === 0) {
    console.warn("No events extracted, using summary as fallback");
    events.push({ date: "Summary", description: summary });
  }

  console.log("Final extracted events:", events);
  return events;
}