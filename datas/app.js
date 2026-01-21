(function () {
  const path = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if ((a.getAttribute("href") || "").toLowerCase() === path) {
      a.classList.add("active");
    }
  });
})();
