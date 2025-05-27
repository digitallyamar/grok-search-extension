// timeline.js
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['timelineEvents', 'pageUrl'], (result) => {
    if (!result || !result.timelineEvents || result.timelineEvents.length === 0) {
      console.error('No timeline events found in storage');
      chrome.runtime.sendMessage({ type: 'closeTimelineTab' });
      return;
    }

    const events = result.timelineEvents;
    const timelineContainer = document.querySelector('#timeline .timeline-container');
    if (!timelineContainer) {
      console.error('Timeline container not found');
      chrome.runtime.sendMessage({ type: 'closeTimelineTab' });
      return;
    }

    // Clear existing content
    timelineContainer.innerHTML = '';

    // Create timeline elements
    events.forEach((event, index) => {
      const eventDiv = document.createElement('div');
      eventDiv.className = 'timeline-event';
      eventDiv.innerHTML = `
        <div class="timeline-circle"></div>
        <strong>${event.date}</strong>
        <p>${event.description}</p>
      `;
      timelineContainer.appendChild(eventDiv);
    });

    // Wait for DOM to settle and render with html2canvas
    setTimeout(() => {
      if (typeof html2canvas === 'undefined') {
        console.error('html2canvas not loaded');
        chrome.runtime.sendMessage({ type: 'closeTimelineTab' });
        return;
      }

      html2canvas(document.getElementById('timeline'), {
        backgroundColor: null, // Transparent background to capture gradient
        scale: 2, // Higher resolution for sharp images
        useCORS: true, // Enable CORS for external resources if needed
      }).then((canvas) => {
        canvas.toBlob((blob) => {
          if (!blob) {
            console.error('Failed to create blob');
            chrome.runtime.sendMessage({ type: 'closeTimelineTab' });
            return;
          }
          const url = URL.createObjectURL(blob);
          chrome.downloads.download({
            url: url,
            filename: 'timeline-infographic.png',
            saveAs: false
          }, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('Download failed:', chrome.runtime.lastError);
            }
            URL.revokeObjectURL(url);
            chrome.runtime.sendMessage({ type: 'closeTimelineTab' });
          });
        }, 'image/png', 1.0); // High-quality PNG
      }).catch((error) => {
        console.error('html2canvas rendering failed:', error);
        chrome.runtime.sendMessage({ type: 'closeTimelineTab' });
      });
    }, 100);
  });
});