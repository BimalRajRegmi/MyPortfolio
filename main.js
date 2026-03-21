(() => {
  // Set your public Itch.io page URL here, for example: https://yourname.itch.io
  const ITCH_PROFILE_URL = "https://bimal-raj-regmi.itch.io/";
  const ITCH_CACHE_TTL_MS = 1000 * 60 * 30;
  const MAX_IMAGE_HYDRATION = 4;

  const normalizeUrl = (url) => {
    try {
      return new URL(url).toString();
    } catch {
      return "";
    }
  };

  const firstSrcFromSrcset = (srcset) => {
    if (!srcset) return "";
    const first = srcset
      .split(",")
      .map((s) => s.trim().split(" ")[0])
      .find(Boolean);
    return first || "";
  };

  const backgroundImageUrlFromStyle = (styleValue) => {
    if (!styleValue) return "";
    const match = styleValue.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i);
    return match?.[2] || "";
  };

  const findProjectImage = (root, fallbackRoot, baseUrl) => {
    const enclosingCell =
      root?.closest(".game_cell, .game_grid_widget .cell, .game_row") ||
      fallbackRoot?.closest(".game_cell, .game_grid_widget .cell, .game_row") ||
      null;

    const candidates = [
      root?.querySelector("img[data-lazy_src]")?.getAttribute("data-lazy_src"),
      root?.querySelector("img[data-lazy-src]")?.getAttribute("data-lazy-src"),
      root?.querySelector("img[src]")?.getAttribute("src"),
      firstSrcFromSrcset(root?.querySelector("img[srcset]")?.getAttribute("srcset")),
      root?.querySelector("[data-background_image]")?.getAttribute("data-background_image"),
      backgroundImageUrlFromStyle(root?.getAttribute("style")),
      enclosingCell?.querySelector("img[data-lazy_src]")?.getAttribute("data-lazy_src"),
      enclosingCell?.querySelector("img[data-lazy-src]")?.getAttribute("data-lazy-src"),
      enclosingCell?.querySelector("img[src]")?.getAttribute("src"),
      firstSrcFromSrcset(
        enclosingCell?.querySelector("img[srcset]")?.getAttribute("srcset")
      ),
      enclosingCell?.querySelector("[data-background_image]")?.getAttribute("data-background_image"),
      backgroundImageUrlFromStyle(enclosingCell?.getAttribute("style")),
      fallbackRoot?.querySelector("img[data-lazy_src]")?.getAttribute("data-lazy_src"),
      fallbackRoot?.querySelector("img[data-lazy-src]")?.getAttribute("data-lazy-src"),
      fallbackRoot?.querySelector("img[src]")?.getAttribute("src"),
      firstSrcFromSrcset(
        fallbackRoot?.querySelector("img[srcset]")?.getAttribute("srcset")
      ),
      fallbackRoot?.querySelector("[data-background_image]")?.getAttribute("data-background_image"),
      backgroundImageUrlFromStyle(fallbackRoot?.getAttribute("style")),
    ].filter(Boolean);

    for (const raw of candidates) {
      const abs = normalizeUrl(new URL(raw, baseUrl).toString());
      if (abs) return abs;
    }
    return "";
  };

  const fetchTextWithTimeout = async (sourceUrl) => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6500);
    try {
      const res = await fetch(sourceUrl, { cache: "default", signal: controller.signal });
      if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
      const text = await res.text();
      if (text && text.length > 100) return text;
      throw new Error("Response too short");
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const fetchTextFromSources = async (url) => {
    const sources = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://r.jina.ai/http://${new URL(url).host}${new URL(url).pathname}`,
    ];
    let lastError = null;
    for (const source of sources) {
      try {
        return await fetchTextWithTimeout(source);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Unable to fetch URL");
  };

  const scoreProjectImageUrl = (url) => {
    const u = (url || "").toLowerCase();
    let score = 0;
    if (u.includes("/original/")) score += 5;
    if (u.includes("cover")) score += 6;
    if (u.includes("thumb") || u.includes("thumbnail")) score += 4;
    if (u.includes("icon")) score += 3;
    if (u.endsWith(".jpg") || u.endsWith(".jpeg")) score += 6;
    if (u.endsWith(".webp")) score += 4;
    if (u.endsWith(".png")) score -= 2;
    if (u.includes("favicon") || u.includes("logo") || u.includes("sprite")) score -= 8;
    if (u.includes("banner") || u.includes("header") || u.includes("background")) score -= 6;
    if (u.includes("avatar") || u.includes("user")) score -= 5;
    return score;
  };

  const pickBestProjectImage = (rawCandidates, baseUrl) => {
    const normalized = (rawCandidates || [])
      .filter(Boolean)
      .map((raw) => normalizeUrl(new URL(raw, baseUrl).toString()))
      .filter(Boolean)
      .filter((u) => u.includes("itch.zone") || u.includes("itch.io"));

    if (!normalized.length) return "";
    normalized.sort((a, b) => scoreProjectImageUrl(b) - scoreProjectImageUrl(a));
    return normalized[0] || "";
  };

  const extractProjectImageFromHtml = (text, baseUrl) => {
    if (!text) return "";
    if (text.includes("<html") || text.includes("<meta")) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      const strongCandidates = [
        ...Array.from(
          doc.querySelectorAll(
            ".game_thumb img, .game_thumbnail img, .cover_image img, .game_cover img, .header .game_thumb img"
          )
        ).map((img) => img.getAttribute("data-lazy_src") || img.getAttribute("data-lazy-src") || img.getAttribute("src")),
      ];

      const genericCandidates = [
        ...Array.from(doc.querySelectorAll("img")).map(
          (img) =>
            img.getAttribute("data-lazy_src") ||
            img.getAttribute("data-lazy-src") ||
            firstSrcFromSrcset(img.getAttribute("srcset")) ||
            img.getAttribute("src")
        ),
      ];

      const metaCandidates = [
        doc.querySelector('meta[property="og:image"]')?.getAttribute("content") || "",
        doc.querySelector('meta[name="twitter:image"]')?.getAttribute("content") || "",
      ];

      // Prefer cover-specific containers first, then generic images, then meta tags.
      const strong = pickBestProjectImage(strongCandidates, baseUrl);
      if (strong && scoreProjectImageUrl(strong) >= 0) return strong;

      const generic = pickBestProjectImage(genericCandidates, baseUrl);
      if (generic && scoreProjectImageUrl(generic) >= 0) return generic;

      return pickBestProjectImage(metaCandidates, baseUrl);
    }

    const ogMatch = text.match(/og:image[^)\n]*\((https?:\/\/[^)\s]+)\)/i);
    const mdImgs = Array.from(
      text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)
    ).map((m) => m[1]);
    const candidates = [ogMatch?.[1] || "", ...mdImgs]
      .filter(Boolean)
      .map((raw) => normalizeUrl(new URL(raw, baseUrl).toString()))
      .filter(Boolean);
    if (!candidates.length) return "";
    candidates.sort((a, b) => scoreProjectImageUrl(b) - scoreProjectImageUrl(a));
    return candidates[0] || "";
  };

  const hydrateProjectImages = async (projects) => {
    const targets = projects.slice(0, MAX_IMAGE_HYDRATION);
    if (!targets.length) return projects;

    await Promise.all(
      targets.map(async (project) => {
        try {
          const text = await fetchTextFromSources(project.url);
          const projectImage = extractProjectImageFromHtml(text, project.url);
          if (projectImage) project.image = projectImage;
        } catch {
          // Keep project without image if image lookup fails.
        }
      })
    );

    return projects;
  };

  const extractItchProjects = (html, baseUrl) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const selectors = [
      "a.game_link",
      "a.thumb_link",
      ".game_cell a.title",
      ".game_cell_data a.title",
      "a[href*='.itch.io/']",
    ];

    const seen = new Set();
    const projects = [];

    doc.querySelectorAll(selectors.join(",")).forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;

      const absoluteHref = normalizeUrl(new URL(href, baseUrl).toString());
      if (!absoluteHref) return;
      if (seen.has(absoluteHref)) return;

      const host = new URL(absoluteHref).hostname;
      if (!host.endsWith("itch.io")) return;

      const titleText =
        link.textContent?.trim() ||
        link.getAttribute("title") ||
        link.querySelector("img")?.getAttribute("alt") ||
        "";
      if (!titleText || titleText.length < 2) return;

      const cell = link.closest(".game_cell, .game_cell_data, .game_thumb");
      const desc =
        cell?.querySelector(".sub, .meta, .game_text, p")?.textContent?.trim() ||
        "Imported from my Itch.io profile.";

      seen.add(absoluteHref);
      projects.push({
        title: titleText,
        url: absoluteHref,
        // Hydrate image from project page to avoid profile banner artifacts.
        image: "",
        description: desc,
      });
    });

    return projects;
  };

  const extractItchProjectsFromGenericLinks = (html, baseUrl) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const profile = new URL(baseUrl);
    const origin = profile.origin;
    const blockedFirstSegments = new Set([
      "",
      "games",
      "jams",
      "developers",
      "devlogs",
      "community",
      "login",
      "register",
      "tools",
      "game-assets",
      "comics",
      "sales",
      "bundles",
      "jobs",
      "tags",
      "game-development",
      "docs",
      "blog",
      "support",
      "directory",
    ]);

    const seen = new Set();
    const projects = [];

    doc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href) return;

      let url;
      try {
        url = new URL(href, baseUrl);
      } catch {
        return;
      }

      if (url.origin !== origin) return;
      if (url.search.includes("add-to-collection")) return;

      const path = url.pathname.replace(/^\/+|\/+$/g, "");
      const segments = path.split("/").filter(Boolean);
      if (!segments.length) return;
      if (segments.length > 1) return; // project pages are usually single-segment
      if (blockedFirstSegments.has(segments[0])) return;

      const title = (a.textContent || "").trim();
      if (!title || title.length < 2) return;
      if (/add to collection/i.test(title)) return;

      const absolute = url.toString();
      if (seen.has(absolute)) return;
      seen.add(absolute);

      projects.push({
        title,
        url: absolute,
        image: "",
        description: "Imported from my Itch.io profile.",
      });
    });

    return projects;
  };

  const extractItchProjectsFromMarkdown = (text, baseUrl) => {
    const profile = new URL(baseUrl);
    const host = profile.host;
    const blockedTitles = /^(Add to collection|Bimal Raj Regmi|itch\.io|Browse Games|Game Jams|Upload Game|Developer Logs|Community)$/i;
    const blockedSegments = new Set([
      "games", "jams", "developers", "devlogs", "community", "login", "register",
      "tools", "game-assets", "comics", "sales", "bundles", "jobs", "tags",
      "game-development", "docs", "blog", "support", "directory",
    ]);

    const lines = text.split(/\r?\n/);
    const seen = new Set();
    const projects = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      const match = line.match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/);
      if (!match) continue;

      const title = match[1]?.trim();
      const href = match[2]?.trim();
      if (!title || !href) continue;
      if (blockedTitles.test(title)) continue;

      let url;
      try {
        url = new URL(href, baseUrl);
      } catch {
        continue;
      }
      if (url.host !== host) continue;
      if (url.search.includes("add-to-collection")) continue;

      const path = url.pathname.replace(/^\/+|\/+$/g, "");
      const segments = path.split("/").filter(Boolean);
      if (segments.length !== 1) continue;
      if (blockedSegments.has(segments[0])) continue;

      const absolute = url.toString();
      if (seen.has(absolute)) continue;

      const descCandidate = (lines[i + 1] || "").trim();
      const description =
        descCandidate &&
        !descCandidate.startsWith("[") &&
        !/^Adventure$|^Platformer$|^Action$|^Puzzle$/i.test(descCandidate)
          ? descCandidate
          : "Imported from my Itch.io profile.";

      seen.add(absolute);
      projects.push({ title, url: absolute, image: "", description });
    }

    return projects;
  };

  const renderItchCards = (container, projects) => {
    if (!container) return;

    if (!projects.length) {
      container.innerHTML =
        '<p class="muted">No projects found on Itch profile right now.</p>';
      return;
    }

    container.innerHTML = projects
      .map((project, i) => {
        const mediaClass =
          i % 4 === 0
            ? "card-media"
            : i % 4 === 1
              ? "card-media card-media-2"
              : i % 4 === 2
                ? "card-media card-media-3"
                : "card-media card-media-4";

        const safeTitle = project.title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const safeDesc = project.description
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .slice(0, 170);

        const media = project.image
          ? `<div class="${mediaClass}" style="background-image: linear-gradient(180deg, rgba(5,9,20,.15), rgba(5,9,20,.35)), url('${project.image.replace(
            /'/g,
            "%27"
          )}'); background-size: contain; background-repeat: no-repeat; background-position: center; background-color: rgba(3,10,23,.65);">
                <div class="card-media-label">Itch.io</div>
             </div>`
          : `<div class="${mediaClass}" aria-hidden="true"><div class="card-media-label">Itch.io</div></div>`;

        return `<article class="card">
          ${media}
          <div class="card-body">
            <div class="card-top">
              <h3>${safeTitle}</h3>
              <div class="card-tag">Itch.io</div>
            </div>
            <p class="card-desc">${safeDesc}</p>
            <div class="card-actions">
              <a class="link" href="${project.url}" target="_blank" rel="noopener">View project</a>
            </div>
          </div>
        </article>`;
      })
      .join("");
  };

  const parseProjectsFromText = (text, profileUrl) => {
    let projects = text.includes("<html")
      ? extractItchProjects(text, profileUrl)
      : extractItchProjectsFromMarkdown(text, profileUrl);
    if (!projects.length && text.includes("<html")) {
      projects = extractItchProjectsFromGenericLinks(text, profileUrl);
    }
    return projects;
  };

  const fetchLiveProjects = async (profileUrl) => {
    const sources = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(profileUrl)}`,
      `https://r.jina.ai/http://${new URL(profileUrl).host}${new URL(profileUrl).pathname}`,
    ];

    let lastError = null;
    for (const source of sources) {
      try {
        const text = await fetchTextWithTimeout(source);
        const projects = parseProjectsFromText(text, profileUrl);
        if (projects.length) return projects;
      } catch (err) {
        lastError = err;
      }
    }

    if (lastError) throw lastError;
    throw new Error("No live projects parsed from available sources");
  };

  const cacheKeyForProfile = (profileUrl) => `itch_projects_cache_v3:${profileUrl}`;

  const readProjectsCache = (profileUrl) => {
    try {
      const raw = localStorage.getItem(cacheKeyForProfile(profileUrl));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.projects || !Array.isArray(parsed.projects)) return null;
      if (!parsed.cachedAt || Date.now() - parsed.cachedAt > ITCH_CACHE_TTL_MS) return null;
      return parsed.projects;
    } catch {
      return null;
    }
  };

  const readProjectsCacheAny = (profileUrl) => {
    try {
      const raw = localStorage.getItem(cacheKeyForProfile(profileUrl));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.projects || !Array.isArray(parsed.projects)) return null;
      return parsed.projects.length ? parsed.projects : null;
    } catch {
      return null;
    }
  };

  const writeProjectsCache = (profileUrl, projects) => {
    try {
      localStorage.setItem(
        cacheKeyForProfile(profileUrl),
        JSON.stringify({ cachedAt: Date.now(), projects })
      );
    } catch {
      // Ignore storage errors.
    }
  };

  const loadItchProjects = async () => {
    const containers = Array.from(document.querySelectorAll("[data-itch-projects]"));
    if (!containers.length) return;

    if (ITCH_PROFILE_URL.includes("YOUR_ITCH_USERNAME")) {
      containers.forEach((el) => {
        el.innerHTML =
          '<p class="muted">Set your Itch profile URL in <code>main.js</code> to auto-load projects.</p>';
      });
      return;
    }

    const profileUrl = normalizeUrl(ITCH_PROFILE_URL);
    if (!profileUrl) return;

    const cachedProjects = readProjectsCache(profileUrl);
    const cachedProjectsAny = readProjectsCacheAny(profileUrl);
    if (cachedProjects?.length) {
      containers.forEach((container) => {
        const limitRaw = container.getAttribute("data-limit");
        const limit = limitRaw ? Number(limitRaw) : 0;
        const scoped =
          Number.isFinite(limit) && limit > 0
            ? cachedProjects.slice(0, limit)
            : cachedProjects;
        renderItchCards(container, scoped);
      });
    } else if (cachedProjectsAny?.length) {
      containers.forEach((container) => {
        const limitRaw = container.getAttribute("data-limit");
        const limit = limitRaw ? Number(limitRaw) : 0;
        const scoped =
          Number.isFinite(limit) && limit > 0
            ? cachedProjectsAny.slice(0, limit)
            : cachedProjectsAny;
        renderItchCards(container, scoped);
      });
    }

    try {
      let allProjects = await fetchLiveProjects(profileUrl);
      allProjects = await hydrateProjectImages(allProjects);
      if (allProjects.length) writeProjectsCache(profileUrl, allProjects);

      containers.forEach((container) => {
        const limitRaw = container.getAttribute("data-limit");
        const limit = limitRaw ? Number(limitRaw) : 0;
        const scoped = Number.isFinite(limit) && limit > 0 ? allProjects.slice(0, limit) : allProjects;
        renderItchCards(container, scoped);
      });
    } catch (err) {
      if (!cachedProjectsAny?.length) {
        containers.forEach((el) => {
          el.innerHTML =
            '<p class="muted">Could not load live Itch data right now. Please refresh in a moment.</p>';
        });
      }
      console.error(err);
    }
  };

  loadItchProjects();

  const progress = document.getElementById("scrollProgress");
  const updateScrollProgress = () => {
    if (!progress) return;
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollHeight =
      document.documentElement.scrollHeight - window.innerHeight;
    const percent = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    progress.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  };
  updateScrollProgress();
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("resize", updateScrollProgress);

  const cursorDot = document.getElementById("cursorDot");
  const cursorRing = document.getElementById("cursorRing");
  if (cursorDot && cursorRing && window.matchMedia("(pointer: fine)").matches) {
    const showCursor = () => {
      cursorDot.style.opacity = "1";
      cursorRing.style.opacity = "1";
    };
    const hideCursor = () => {
      cursorDot.style.opacity = "0";
      cursorRing.style.opacity = "0";
    };

    window.addEventListener("mousemove", (e) => {
      const x = e.clientX;
      const y = e.clientY;
      cursorDot.style.transform = `translate(${x}px, ${y}px)`;
      cursorRing.style.transform = `translate(${x}px, ${y}px)`;
      showCursor();
    });
    window.addEventListener("mouseout", hideCursor);
    window.addEventListener("mousedown", () =>
      cursorRing.classList.add("cursor-ring--active")
    );
    window.addEventListener("mouseup", () =>
      cursorRing.classList.remove("cursor-ring--active")
    );
  }

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".nav");
  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      nav.classList.toggle("open");
    });
    // Close nav after clicking a link (mobile).
    nav.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => nav.classList.remove("open"));
    });
  }

  // Smooth anchor scrolling.
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const href = a.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  const contactForm = document.getElementById("contactForm");
  const contactHint = document.getElementById("contactHint");
  if (!contactForm) return;

  contactForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!contactHint) return;

    const name = contactForm.elements["name"].value.trim();
    const email = contactForm.elements["email"].value.trim();
    const message = contactForm.elements["message"].value.trim();

    // NOTE: replace this with your real email.
    const to = "regmi8756@gmail.com";
    const subject = `Portfolio inquiry from ${name}`;
    const body = `Name: ${name}\nEmail: ${email}\n\nMessage:\n${message}`;

    contactHint.textContent = "Opening your email client...";

    // Mailto encoding.
    const mailto = `mailto:${to}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  });
})();

