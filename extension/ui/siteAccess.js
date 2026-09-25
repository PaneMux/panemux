// "PaneMux can't reach websites" banner for the settings page and tutorial.
//
// Chrome grants host access at install. Firefox lets people withhold it (or
// take it back later from the extensions menu), and then PaneMux silently
// does nothing on every site. This shows why, with a one-click fix.
PaneMux.SiteAccess = (() => {
  const ALL = { origins: ["<all_urls>"] };

  const granted = () => chrome.permissions.contains(ALL).catch(() => true);

  // Put the banner at the top of `container`; it hides itself once access is granted.
  function mount(container) {
    const box = document.createElement("div");
    box.className = "banner access";
    box.id = "site-access";
    box.hidden = true;
    box.setAttribute("role", "alert");
    const text = document.createElement("div");
    const b = document.createElement("b");
    b.textContent = "PaneMux can't reach any websites yet.";
    text.append(b, " Your browser is holding back its access, so keys won't do anything on pages.");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "grant-access";
    btn.textContent = "Allow on all websites";
    // permissions.request() must run straight from the click.
    btn.addEventListener("click", () => chrome.permissions.request(ALL).then(refresh, refresh));
    box.append(text, btn);
    container.prepend(box);

    async function refresh() { box.hidden = await granted(); }
    chrome.permissions.onAdded?.addListener(refresh);
    chrome.permissions.onRemoved?.addListener(refresh);
    refresh();
    return box;
  }

  return { mount, granted };
})();
