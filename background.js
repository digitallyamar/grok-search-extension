// Remove existing context menu items to prevent duplicates
chrome.contextMenus.removeAll(() => {
  console.log("Context menu cleared and creating new one");
  chrome.contextMenus.create({
    id: "search-with-grok",
    title: "Search with Grok: '%s'",
    contexts: ["selection"]
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
  // Remove existing popup if it exists
  const existingPopup = document.getElementById("grok-search-popup");
  if (existingPopup) {
    console.log("Removing existing popup");
    existingPopup.remove();
  }

  // Fetch popup HTML
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

      // Verify popup visibility
      const popup = document.getElementById("grok-search-popup");
      if (popup) {
        console.log("Popup element found in DOM");
      } else {
        console.error("Popup element not found in DOM");
      }

      // Set selected text
      const selectedTextElement = document.getElementById("selected-text");
      if (selectedTextElement) {
        selectedTextElement.textContent = selectedText;
        console.log("Selected text set:", selectedText);
      } else {
        console.error("Selected text element not found");
      }

      // Handle search button
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

        // Handle Enter key in input field
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

      // Handle cancel button
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