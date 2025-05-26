// Check if we're on grok.com and there's a stored query
chrome.storage.local.get(["grokQuery"], (result) => {
  console.log("Content script running, checking for grokQuery:", result);
  if (result.grokQuery && window.location.href.includes("grok.com")) {
    console.log("On grok.com with query:", result.grokQuery);
    function tryInjectQuery() {
      const inputField = document.querySelector("input[type='text'], input[type='search'], textarea, [contenteditable='true']");
      if (inputField) {
        console.log("Input field found, injecting query:", result.grokQuery);
        inputField.value = result.grokQuery;
        const inputEvent = new Event("input", { bubbles: true });
        inputField.dispatchEvent(inputEvent);
        const enterEvent = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          keyCode: 13
        });
        inputField.dispatchEvent(enterEvent);
        chrome.storage.local.remove("grokQuery", () => {
          console.log("Query injected and storage cleared");
        });
      } else {
        console.log("Input field not found, retrying...");
        setTimeout(tryInjectQuery, 500);
      }
    }
    if (document.readyState === "complete") {
      console.log("Page loaded, trying to inject query");
      tryInjectQuery();
    } else {
      console.log("Waiting for page load");
      window.addEventListener("load", tryInjectQuery);
    }
  }
});