// Remove existing context menu items to prevent duplicates
chrome.contextMenus.removeAll(() => {
  console.log("Context menu cleared and creating new ones");
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
    // Inject script to extract webpage text
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageText
    }, (results) => {
      console.log("Text extraction result:", results);
      if (results && results[0] && results[0].result) {
        const pageText = results[0].result;
        const pageUrl = info.pageUrl; // Get the webpage URL
        const prompt = `Provide the historical context for the topic discussed in this text and summarize it in 100–200 words: ${pageText}. For more details, refer to: ${pageUrl}`;
        console.log("Sending summary query to Grok, length:", prompt.length);
        chrome.storage.local.set({ grokQuery: prompt }, () => {
          chrome.tabs.create({ url: "https://grok.com" }, () => {
            console.log("Grok tab opened for summary");
          });
        });
      } else {
        console.error("Failed to extract page text");
      }
    });
  }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received:", request);
  if (request.type === "searchGrok") {
    console.log("Storing query and opening grok.com:", request.query);
    chrome.storage.local.set({ grokQuery: request.query }, () => {
      chrome.tabs.create({ url: "https://grok.com" }, () => {
        console.log("Grok tab opened");
      });
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
        console.log("Popup element found in DOM");
      } else {
        console.error("Popup element not found in DOM");
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

// Function to extract webpage text (injected into page)
function extractPageText() {
  let pageText = document.body.innerText || '';
  // Limit text to 10,000 characters to avoid overwhelming Grok
  if (pageText.length > 10000) {
    pageText = pageText.substring(0, 10000) + '...';
  }
  // Clean up excessive whitespace
  pageText = pageText.replace(/\s+/g, ' ').trim();
  return pageText;
}