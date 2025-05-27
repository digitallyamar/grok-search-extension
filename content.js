// content.js
// Check if we're on page load and retrieve stored data
chrome.storageData = null;
chrome.storage.local.get(["grokQuery", "grokTabId", "timelineEvents", "pageUrl"], (result) => {
  console.log("Content script retrieved data:", result);
  chrome.storageData = result;

  // Handle Grok query injection
  if (result.grokQuery && window.location.href.includes("grok.com")) {
    console.log("On grok.com with query:", result.grokQuery);
    function tryInjectQuery() {
      const isLoading = document.querySelector(".loading, [aria-busy='true'], [class*='spinner']");
      if (isLoading) {
        console.log("Page is still loading, retrying...");
        setTimeout(tryInjectQuery, 1000);
        return;
      }

      const inputField = document.querySelector(
        "input[type='text'], input[type='search'], textarea, [contenteditable='true']"
      );
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
        chrome.storage.local.remove(["grokQuery"], () => {
          console.log("Query injected and storage cleared");
          observeSummary(result.grokTabId);
        });
      } else {
        console.log("Input field not found, retrying...");
        setTimeout(tryInjectQuery, 1000);
      }
    }
    if (document.readyState === "complete") {
      console.log("Page loaded, trying to inject query");
      tryInjectQuery();
    } else {
      console.log("Waiting for page load");
      window.addEventListener("load", () => tryInjectQuery());
    }
  }

  // Handle timeline rendering
  if (window.location.href.includes("timeline.html")) {
    console.log("On timeline.html, fetching events...");
    chrome.storage.local.get(["timelineEvents", "pageUrl"], (data) => {
      console.log("Timeline storage data:", JSON.stringify(data, null, 2));
      const events = data.timelineEvents || [];
      const url = data.pageUrl || "Unknown Source";
      console.log("Events to render:", events, "URL:", url);
      renderTimeline(events, url);
    });
  }
});

// Function to observe DOM for Grok's summary with debouncing
function observeSummary(grokTabId) {
  let attempts = 0;
  const maxAttempts = 240; // 120 seconds
  let retryCount = 0;
  const maxRetries = 3;
  let lastSummary = '';
  let stableCount = 0;
  const stableThreshold = 6; // 3 seconds (6 * 500ms)
  let summarySent = false;
  let debounceTimeout = null;

  const observer = new MutationObserver((mutationsList) => {
    if (debounceTimeout || summarySent) {
      console.log("Debouncing or summary already sent, ignoring mutations");
      return;
    }

    debounceTimeout = setTimeout(() => {
      mutationsList.forEach((mutation) => {
        console.log("DOM mutation detected, type:", mutation.type, "nodes:", mutation.addedNodes.length, "target:", mutation.target.tagName);
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          console.log("Style attribute changed, checking for visibility:", mutation.target.style.display);
        }
      });

      const responseContainers = document.querySelectorAll(
        ".response-content-markdown, .message-bubble"
      );
      console.log("Found", responseContainers.length, "potential response containers");

      for (const container of responseContainers) {
        const paragraphs = container.querySelectorAll("p.break-words");
        let summary = Array.from(paragraphs)
          .map(p => p.textContent.trim())
          .filter(text => text.length > 0)
          .join(" ");

        console.log("Potential summary from container:", {
          outerHTML: container.outerHTML.slice(0, 200),
          text: summary.substring(0, 100),
          paragraphCount: paragraphs.length
        });

        if (
          summary.length > 200 &&
          summary.split(/\s+/).filter(w => w.length > 0).length >= 50 &&
          !summary.includes("Provide the historical context") &&
          !summary.includes("=>") &&
          !summary.includes("function(") &&
          !summary.includes("gtag(") &&
          !summary.includes("How can Grok help?") &&
          !summary.includes("DeepSearch") &&
          !summary.includes("Create New Chat") &&
          !summary.match(/^(Today|Yesterday|\d+\s+hours\s+ago)/) &&
          summary.match(/[.!?]/)
        ) {
          if (summary === lastSummary) {
            stableCount++;
            console.log("Summary stable, count:", stableCount);
          } else {
            stableCount = 0;
            lastSummary = summary;
            console.log("Summary changed, resetting stable count:", summary.substring(0, 100));
          }

          if (stableCount >= stableThreshold) {
            console.log("Summary captured:", summary);
            chrome.storage.local.get(["pageUrl"], (data) => {
              chrome.runtime.sendMessage({
                type: "summaryReceived",
                summary,
                pageUrl: data.pageUrl
              });
              observer.disconnect();
              summarySent = true;
            });
            break;
          }
        } else {
          console.log("Container skipped, not a valid summary:", summary.substring(0, 100));
        }
      }

      attempts++;
      if (attempts >= maxAttempts && !summarySent) {
        console.error("No summary found after max attempts, retrying:", retryCount + 1);
        observer.disconnect();
        if (retryCount < maxRetries) {
          retryCount++;
          attempts = 0;
          stableCount = 0;
          lastSummary = '';
          setTimeout(() => {
            observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
            console.log("Restarted observation, retry:", retryCount);
          }, 3000);
        } else {
          console.error("Max retries reached, falling back to polling");
          startPolling();
        }
      }
      debounceTimeout = null;
    }, 500); // Debounce for 500ms
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  console.log("Started observing DOM for summary, retry:", retryCount);

  function startPolling() {
    if (summarySent) {
      console.log("Summary already sent, skipping polling");
      return;
    }

    let pollAttempts = 0;
    const maxPollAttempts = 180; // 90 seconds
    const pollInterval = setInterval(() => {
      const responseContainers = document.querySelectorAll(
        ".response-content-markdown, .message-bubble"
      );
      console.log("Polling found", responseContainers.length, "containers");

      for (const container of responseContainers) {
        const paragraphs = container.querySelectorAll("p.break-words");
        let summary = Array.from(paragraphs)
          .map(p => p.textContent.trim())
          .filter(text => text.length > 0)
          .join(" ");

        console.log("Polling potential summary:", {
          outerHTML: container.outerHTML.slice(0, 200),
          text: summary.substring(0, 100)
        });

        if (
          summary.length > 200 &&
          summary.split(/\s+/).filter(w => w.length > 0).length >= 50 &&
          !summary.includes("Provide the historical context") &&
          !summary.includes("=>") &&
          !summary.includes("function(") &&
          !summary.includes("gtag(") &&
          !summary.includes("How can Grok help?") &&
          !summary.includes("DeepSearch") &&
          !summary.includes("Create New Chat") &&
          !summary.match(/^(Today|Yesterday|\d+\s+hours\s+ago)/) &&
          summary.match(/[.!?]/)
        ) {
          console.log("Summary captured via polling:", summary);
          chrome.storage.local.get(["pageUrl"], (data) => {
            chrome.runtime.sendMessage({
              type: "summaryReceived",
              summary,
              pageUrl: data.pageUrl
            });
            clearInterval(pollInterval);
            summarySent = true;
          });
          return;
        }
      }

      pollAttempts++;
      if (pollAttempts >= maxPollAttempts) {
        console.error("No summary found after polling, notifying user");
        chrome.runtime.sendMessage({
          type: "summaryReceived",
          summary: "Summary not found",
          pageUrl: chrome.storageData.pageUrl
        });
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "Grok Search Error",
          message: "Failed to capture historical context from Grok. Please try again."
        });
        clearInterval(pollInterval);
        summarySent = true;
      }
    }, 500);
    console.log("Started polling for summary");
  }
}

// Function to render timeline and capture image
function renderTimeline(events, pageUrl) {
  console.log("renderTimeline called with events:", JSON.stringify(events, null, 2), "pageUrl:", pageUrl);
  const timeline = document.getElementById("timeline");
  if (!timeline) {
    console.error("Timeline element not found in DOM");
    chrome.runtime.sendMessage({ type: "closeTimelineTab" });
    return;
  }

  let eventHtml = '';
  if (!events || events.length === 0) {
    console.error("No events provided, rendering fallback");
    eventHtml = '<div class="event"><div class="date">N/A</div><div class="description">No historical events extracted.</div></div>';
  } else {
    events.forEach((event, index) => {
      console.log("Processing event:", JSON.stringify(event, null, 2));
      const date = event.date || `Event ${index + 1}`;
      const description = event.description || "No description available";
      eventHtml += `
        <div class="event">
          <div class="date">${escapeHtml(date)}</div>
          <div class="description">${escapeHtml(description)}</div>
        </div>
      `;
    });
  }

  timeline.innerHTML = `
    <h1>Historical Timeline</h1>
    ${eventHtml}
    <div class="footer">
      Source: <a href="${pageUrl}">${pageUrl}</a>
    </div>
  `;
  console.log("Timeline HTML set:", timeline.innerHTML);

  // Force DOM update
  timeline.offsetHeight; // Trigger reflow
  console.log("Timeline DOM height:", timeline.offsetHeight);

  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("html2canvas.min.js");
  document.head.appendChild(script);

  script.onload = () => {
    console.log("html2canvas loaded");
    if (typeof html2canvas === 'undefined') {
      console.error("html2canvas not loaded properly");
      chrome.runtime.sendMessage({ type: "closeTimelineTab" });
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: "Grok Search Error",
        message: "Failed to load html2canvas for timeline generation."
      });
      return;
    }
    // Delay to ensure DOM rendering
    setTimeout(() => {
      html2canvas(timeline, { scale: 2, backgroundColor: '#fff' }).then(canvas => {
        canvas.toBlob((blob) => {
          if (!blob) {
            console.error("Failed to create blob");
            chrome.runtime.sendMessage({ type: "closeTimelineTab" });
            return;
          }
          const url = URL.createObjectURL(blob);
          chrome.downloads.download({
            url: url,
            filename: "timeline_infographic.png",
            saveAs: false
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error("Download failed:", chrome.runtime.lastError);
            }
            URL.revokeObjectURL(url);
            chrome.runtime.sendMessage({ type: "closeTimelineTab" });
          });
        });
      }).catch(error => {
        console.error("Error capturing timeline:", error);
        chrome.runtime.sendMessage({ type: "closeTimelineTab" });
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "Grok Search Error",
          message: "Failed to generate timeline image."
        });
      });
    }, 100);
  };
  script.onerror = () => {
    console.error("Failed to load html2canvas");
    chrome.runtime.sendMessage({ type: "closeTimelineTab" });
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "Grok Search Error",
      message: "Failed to load html2canvas library."
    });
  };
}

// Utility to escape HTML to prevent rendering issues
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}