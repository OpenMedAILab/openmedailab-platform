document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  const submitter = event.submitter;
  if (submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement) {
    submitter.dataset.originalText = submitter.value || submitter.textContent || "";
    window.setTimeout(() => {
      submitter.disabled = true;
      if (submitter.tagName === "BUTTON") {
        submitter.textContent = "提交中";
      } else {
        submitter.value = "提交中";
      }
    }, 0);
  }
});
