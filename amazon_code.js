// Script pour extraire les données d'un produit Amazon (ou du premier résultat d'une recherche)
const URL = "{{ target_url }}";

console.log("[INFO] Démarrage du script Amazon...");

try {
  console.log(`[INFO] Navigation vers : ${URL}`);

  await page.goto(URL, {
    waitUntil: "networkidle2",
    timeout: 60000,
  });

  // 1) DÉTECTION PAGE DE RECHERCHE VS PAGE PRODUIT
  // Attendre un peu plus que le DOM soit peuplé
  await new Promise((r) => setTimeout(r, 2000));

  const pageState = await page.evaluate(() => {
    const isSearch = !!document.querySelector(
      '.s-result-item, [data-component-type="s-search-result"]',
    );
    const isProduct = !!document.getElementById("productTitle");
    const isCaptcha =
      document.title.includes("Robot Check") ||
      !!document.querySelector('form[action="/errors/validateCaptcha"]');
    const isBlocked = document.body.textContent.includes(
      "To discuss automated access to Amazon data please contact",
    );
    return {
      isSearch,
      isProduct,
      isCaptcha,
      isBlocked,
      title: document.title,
      htmlLength: document.body.innerHTML.length,
    };
  });

  console.log(`[INFO] État de la page :`, pageState);

  if (
    pageState.isCaptcha ||
    pageState.isBlocked ||
    (!pageState.isSearch && !pageState.isProduct)
  ) {
    console.log("[WARN] Amazon Bloqué ou Captcha détecté");
    const screenshot = await page.screenshot({ encoding: "base64" });
    return {
      success: false,
      error: pageState.isCaptcha
        ? "Captcha"
        : pageState.isBlocked
          ? "Blocked"
          : "Empty/Unknown",
      pageTitle: pageState.title,
      screenshot: `data:image/png;base64,${screenshot}`,
      htmlPreview:
        pageState.htmlLength > 0
          ? "Content exists but not recognized"
          : "Blank Page",
    };
  }

  if (pageState.isSearch) {
    console.log(
      "[INFO] Page de recherche détectée. Recherche du premier produit...",
    );
    const firstProductUrl = await page.evaluate(() => {
      // Essayer plusieurs sélecteurs de liens de produits
      const selectors = [
        'div[data-component-type="s-search-result"] h2 a',
        ".s-result-item h2 a",
        ".a-link-normal.s-no-outline",
        'a.a-link-normal[href*="/dp/"]',
      ];
      for (const sel of selectors) {
        const link = document.querySelector(sel);
        if (link && link.href) return link.href;
      }
      return null;
    });

    if (!firstProductUrl) {
      throw new Error("Aucun produit trouvé dans les résultats de recherche");
    }

    console.log(
      `[INFO] Navigation vers le premier produit : ${firstProductUrl}`,
    );
    await page.goto(firstProductUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  }

  // Attendre un peu pour le JS
  await new Promise((r) => setTimeout(r, 3000));

  // 2) EXTRACTION DES DONNÉES PRODUIT
  const productData = await page.evaluate(() => {
    const getVal = (sel) =>
      document.querySelector(sel)?.textContent?.trim() || null;

    // Titre
    const title = getVal("#productTitle");

    // Images
    const mainImg =
      document.querySelector("#landingImage")?.src ||
      document.querySelector("#main-image")?.src;
    const moreImages = Array.from(document.querySelectorAll("#altImages img"))
      .map((img) => img.src)
      .filter((src) => src && !src.includes("sprite"));

    // Prix
    const priceSelectors = [
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
      "#price_inside_buybox",
      ".apexPriceToPay .a-offscreen",
    ];
    let price = null;
    for (const sel of priceSelectors) {
      const p = document.querySelector(sel)?.textContent?.trim();
      if (p) {
        price = p;
        break;
      }
    }

    // Caractéristiques (bullets)
    const featureSelectors = [
      "#feature-bullets li span",
      "#featurebullets_feature_div li span",
      ".a-list-item",
    ];
    let features = [];
    for (const sel of featureSelectors) {
      const items = Array.from(document.querySelectorAll(sel))
        .map((s) => s.textContent.trim())
        .filter(
          (t) =>
            t &&
            t.length > 10 &&
            !t.includes("Découvrez") &&
            !t.includes("cliquez ici"),
        );
      if (items.length > 0) {
        features = items;
        break;
      }
    }

    // Spécifications techniques & Description
    const attributes = {};
    // Description courte/longue
    const description =
      document.querySelector("#productDescription")?.textContent?.trim() ||
      document.querySelector("#feature-bullets")?.textContent?.trim();
    if (description) attributes["Description"] = description;

    // Tableau de spécifications
    const specRows = document.querySelectorAll(
      ".prodDetTable tr, #productDetails_techSpec_section_1 tr, #detailBullets_feature_div li",
    );
    specRows.forEach((row) => {
      const label = (
        row.querySelector("th, .a-list-item b, .prodDetSectionEntry")
          ?.textContent || ""
      )
        .replace(":", "")
        .trim();
      const value = (
        row.querySelector("td, .a-list-item span:last-child, .prodDetAttrValue")
          ?.textContent || ""
      ).trim();
      if (label && value && label.length > 1) attributes[label] = value;
    });

    return {
      success: true,
      title,
      images: [mainImg, ...moreImages].filter(Boolean).slice(0, 10),
      price,
      features: features.slice(0, 10),
      attributes,
      url: window.location.href,
    };
  });

  console.log("[SUCCESS] Extraction réussie pour:", productData.title);
  return productData;
} catch (error) {
  console.error("[ERROR]", error.message);
  return {
    success: false,
    error: error.message,
  };
}
