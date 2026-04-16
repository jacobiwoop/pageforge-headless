// Script complet pour extraire titre + caractéristiques d'Alibaba
const URL = "https://www.alibaba.com/product-detail/Universal-Cellular-Single-Band-900-1800_1600525050220.html";

console.log('[INFO] Démarrage du script Alibaba...');

try {
  console.log('[INFO] Navigation vers Alibaba...');

  await page.goto(URL, { 
    waitUntil: 'domcontentloaded',
    timeout: 60000 
  });

  console.log('[INFO] Page chargée');

  // Attendre que le JS s'exécute
  await new Promise(r => setTimeout(r, 5000));

  // Vérifier le titre de la page
  const pageTitle = await page.title();
  console.log('[INFO] Titre de la page:', pageTitle);

  // Si captcha détecté
  if (pageTitle.includes('Captcha') || pageTitle.includes('Verification') || pageTitle.includes('Security')) {
    console.log('[WARN] Captcha détecté');

    const screenshot = await page.screenshot({ 
      encoding: 'base64',
      fullPage: false 
    });

    return {
      success: false,
      error: 'Captcha détecté',
      pageTitle,
      screenshot: `data:image/png;base64,${screenshot.substring(0, 100)}...`
    };
  }

  // 1) RÉCUPÉRER LE TITRE DU PRODUIT
  console.log('[INFO] Recherche du titre produit...');

  let productTitle = null;
  let titleSelector = null;

  const selectors = [
    'h1[title]',
    '.product-title h1',
    'h1.product-title',
    '[data-spm] h1',
    'div[class*="title"] h1',
    'h1'
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);

      if (element) {
        const data = await page.evaluate(el => {
          return {
            title: el.getAttribute('title'),
            text: el.textContent,
            class: el.className,
            id: el.id
          };
        }, element);

        if (data.title || data.text) {
          productTitle = data.title || data.text.trim();
          titleSelector = selector;
          console.log('[SUCCESS] Titre trouvé:', productTitle);
          break;
        }
      }
    } catch (e) {
      continue;
    }
  }

  // 2) EXTRAIRE LES IMAGES DU PRODUIT
  console.log('[INFO] Extraction des images...');

  const images = await page.evaluate(() => {
    const imageUrls = [];
    
    // Fonction pour normaliser les URLs d'image
    const normalizeImageUrl = (url) => {
      if (!url) return null;
      // Ajouter https: si l'URL commence par //
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }
      // Remplacer la version thumbnail par la version haute qualité
      url = url.replace(/_\d+x\d+q?\d*\.jpg/i, '.jpg');
      url = url.replace(/_\d+x\d+\.jpg/i, '.jpg');
      return url;
    };

    // 1) Extraire depuis les thumbnails (liste à gauche)
    const thumbs = document.querySelectorAll('[data-submodule="ProductImageThumbsList"] [role="group"]');
    thumbs.forEach(thumb => {
      const bgStyle = thumb.querySelector('[style*="background-image"]');
      if (bgStyle) {
        const style = bgStyle.getAttribute('style');
        const match = style.match(/url\(['"]?([^'"()]+)['"]?\)/);
        if (match && match[1]) {
          const url = normalizeImageUrl(match[1]);
          if (url && !imageUrls.includes(url)) {
            imageUrls.push(url);
          }
        }
      }
    });

    // 2) Extraire depuis le carrousel principal
    const mainImages = document.querySelectorAll('[data-testid="media-image"] img');
    mainImages.forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src) {
        const url = normalizeImageUrl(src);
        if (url && !imageUrls.includes(url)) {
          imageUrls.push(url);
        }
      }
    });

    // 3) Extraire depuis les images du carrousel (slides)
    const slides = document.querySelectorAll('[data-submodule="ProductImageMain"] [role="group"] img');
    slides.forEach(img => {
      const src = img.getAttribute('src') || img.getAttribute('data-src');
      if (src) {
        const url = normalizeImageUrl(src);
        if (url && !imageUrls.includes(url)) {
          imageUrls.push(url);
        }
      }
    });

    // 4) Extraire l'image actuellement affichée (current-main-image)
    const currentImage = document.querySelector('.current-main-image img');
    if (currentImage) {
      const src = currentImage.getAttribute('src') || currentImage.getAttribute('data-src');
      if (src) {
        const url = normalizeImageUrl(src);
        if (url && !imageUrls.includes(url)) {
          imageUrls.push(url);
        }
      }
    }

    return imageUrls;
  });

  if (images && images.length > 0) {
    console.log('[SUCCESS] Images extraites:', images.length, 'images');
  } else {
    console.log('[WARN] Aucune image trouvée');
  }

  // 3) EXTRAIRE LES CARACTÉRISTIQUES EN CLÉ/VALEUR (JSON plat)
  console.log('[INFO] Extraction des caractéristiques (clé/valeur)...');

  const attributesKV = await page.evaluate(() => {
    const result = {};

    // Trouver le module des caractéristiques
    const attributeModule = document.querySelector('div[data-module-name="module_attribute"]');
    if (!attributeModule) return null;

    // Sélectionner toutes les lignes (2 colonnes: libellé + valeur)
    // On cible les lignes dont la grille est 2fr/3fr, présent dans l'exemple fourni
    const rowSelector = 'div.id-grid.id-grid-cols-\\[2fr_3fr\\]';
    const rows = attributeModule.querySelectorAll(rowSelector);

    if (!rows || rows.length === 0) return null;

    const norm = (s) => (s || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u00A0\t\n\r]+/g, ' ')
      .replace(/\s*:\s*$/, '')
      .trim();

    rows.forEach(row => {
      try {
        const cells = row.children;
        if (!cells || cells.length < 2) return;

        const labelEl = cells[0];
        const valueEl = cells[1];

        // Alibaba met souvent la valeur "propre" dans l'attribut title
        const rawLabel = labelEl?.getAttribute('title') || labelEl?.textContent || '';
        const rawValue = valueEl?.getAttribute('title') || valueEl?.textContent || '';

        const label = norm(rawLabel);
        const value = norm(rawValue);

        if (label && value) {
          // Si le label existe déjà, on concatène (cas de sections multiples)
          if (Object.prototype.hasOwnProperty.call(result, label)) {
            const current = result[label];
            if (Array.isArray(current)) {
              if (!current.includes(value)) current.push(value);
            } else if (current !== value) {
              result[label] = [current, value];
            }
          } else {
            result[label] = value;
          }
        }
      } catch (_) {}
    });

    return Object.keys(result).length ? result : null;
  });

  if (attributesKV) {
    console.log('[SUCCESS] Caractéristiques extraites:', Object.keys(attributesKV).length, 'paires');
  } else {
    console.log('[WARN] Caractéristiques non trouvées');
  }

  // 4) EXTRAIRE LES PRIX (ladder ou range)
  console.log('[INFO] Extraction des prix...');

  const prices = await page.evaluate(() => {
    const norm = (s) => (s || '').replace(/[\u00A0\t\n\r]+/g, ' ').replace(/\s+/g, ' ').trim();
    const onlyDigits = (s) => (s || '').replace(/[^0-9]/g, '');

    const parseMoney = (text) => {
      const t = norm(text);
      // Sépare la partie numérique de la devise (dernières lettres/signes)
      // Exemple: "33 933 F CFA" -> amount=33933, currency="F CFA"
      const m = t.match(/([0-9][0-9\s,.]*)\s*([^0-9]*)$/);
      if (!m) return { amount: null, currency: null, raw: t };
      const numStr = onlyDigits(m[1]);
      const amount = numStr ? parseInt(numStr, 10) : null;
      const currency = norm(m[2]) || null;
      return { amount, currency, raw: t };
    };

    const parseRangeMoney = (text) => {
      // Exemple: "6 378-12 813 F CFA"
      const t = norm(text);
      const currencyMatch = t.match(/([^0-9\-]*?)$/); // trailing currency part (may be empty)
      const currency = norm(currencyMatch ? currencyMatch[1] : '') || null;
      const numericPart = t.replace(currency || '', '').trim();
      const parts = numericPart.split('-').map(p => p.trim());
      if (parts.length === 2) {
        const min = onlyDigits(parts[0]);
        const max = onlyDigits(parts[1]);
        return {
          minAmount: min ? parseInt(min, 10) : null,
          maxAmount: max ? parseInt(max, 10) : null,
          currency,
          raw: t
        };
      }
      // Fallback: single value
      const single = parseMoney(t);
      return { minAmount: single.amount, maxAmount: single.amount, currency: single.currency, raw: t };
    };

    const getUnitFromText = (text) => {
      const t = norm(text);
      // Prend le dernier mot alphabétique comme unité
      const m = t.match(/([A-Za-zÀ-ÖØ-öø-ÿ]+)\s*$/);
      return m ? m[1].toLowerCase() : null;
    };

    const mod = document.querySelector('div[data-module-name="module_price"]');
    if (!mod) return null;

    const out = { type: null, currency: null, unit: null };

    // 4.1 Ladder price (paliers)
    const ladder = mod.querySelector('[data-testid="ladder-price"]');
    if (ladder) {
      out.type = 'ladder';
      out.ladder = [];
      ladder.querySelectorAll('.price-item').forEach(item => {
        try {
          const qtyText = norm(item.querySelector('.id-mb-2')?.textContent || '');
          const priceText = norm(item.querySelector('.id-text-2xl')?.textContent || '');
          if (!qtyText || !priceText) return;

          // Déterminer unité
          const unit = getUnitFromText(qtyText);
          if (unit) out.unit = out.unit || unit;

          // Quantités
          let minQty = null, maxQty = null, relation = null;
          const between = qtyText.match(/(\d+)\s*-\s*(\d+)/);
          const gte = qtyText.match(/>=\s*(\d+)/);
          if (between) {
            minQty = parseInt(between[1], 10);
            maxQty = parseInt(between[2], 10);
          } else if (gte) {
            minQty = parseInt(gte[1], 10);
            relation = '>=';
          } else {
            const single = qtyText.match(/(\d+)/);
            if (single) minQty = parseInt(single[1], 10);
          }

          const money = parseMoney(priceText);
          if (money.currency) out.currency = out.currency || money.currency;

          out.ladder.push({
            minQty, maxQty, relation, unit: unit || out.unit, price: money.amount, currency: money.currency, rawPrice: money.raw, rawQty: qtyText
          });
        } catch (_) {}
      });

      // Si aucun palier parsé, continuer
      if (out.ladder.length > 0) return out;
    }

    // 4.2 Range price (prix min-max + MOQ)
    const range = mod.querySelector('[data-testid="range-price"]');
    if (range) {
      out.type = 'range';
      const moqText = norm(range.querySelector('.id-mb-2')?.textContent || '');
      const priceText = norm(range.querySelector('span.id-text-2xl')?.textContent || '');
      if (moqText) {
        const qty = moqText.match(/(\d+)/);
        const unit = getUnitFromText(moqText);
        out.moq = { quantity: qty ? parseInt(qty[1], 10) : null, unit };
        if (unit) out.unit = out.unit || unit;
      }
      if (priceText) {
        const pr = parseRangeMoney(priceText);
        out.priceRange = { min: pr.minAmount, max: pr.maxAmount };
        out.currency = pr.currency;
      }

      // Sample price si présent
      const sample = mod.querySelector('[data-testid="fortifiedSample"]');
      if (sample) {
        const txt = norm(sample.querySelector('span:last-child')?.textContent || '');
        if (txt) {
          const pr = parseRangeMoney(txt);
          out.sample = { min: pr.minAmount, max: pr.maxAmount, currency: pr.currency };
          out.currency = out.currency || pr.currency;
        }
      }

      if (out.priceRange || out.moq) return out;
    }

    return null;
  });

  if (prices) {
    console.log('[SUCCESS] Prix extraits:', prices.type || 'inconnu');
  } else {
    console.log('[WARN] Prix non trouvés');
  }

  // 5) EXTRAIRE LES SPÉCIFICATIONS (variantes disponibles dans le panneau SKU)
  console.log('[INFO] Extraction des spécifications...');

  // Vérifier et cliquer sur le bouton "Sélectionner" si présent
  try {
    // D'abord vérifier si le panneau est déjà ouvert
    const panelOpened = await page.evaluate(() => {
      return !!document.querySelector('[data-testid="sku-panel-sku"][data-show-type="skuPanel"]');
    });

    if (!panelOpened) {
      console.log('[INFO] Panneau SKU fermé, tentative d\'ouverture...');
      
      // Essayer le bouton principal avec data-testid="sku-action"
      const selectButton = await page.$('a[data-testid="sku-action"]');
      
      if (selectButton) {
        console.log('[INFO] Bouton "Sélectionner" détecté, clic en cours...');
        await selectButton.click();
        
        // Attendre que le panneau s'ouvre
        await page.waitForSelector('[data-testid="sku-panel-sku"][data-show-type="skuPanel"]', { 
          timeout: 3000 
        });
        
        console.log('[SUCCESS] Panneau SKU ouvert via bouton principal');
        
        // Attendre un peu que le contenu se charge
        await new Promise(r => setTimeout(r, 1000));
      } else {
        console.log('[INFO] Bouton principal non trouvé, tentative avec sélecteurs alternatifs...');
        
        // Essayer avec d'autres sélecteurs textuels
        const trySelectors = [
          'a:has-text("Sélectionner")',
          'text=Sélectionner',
          'text=Sélectionnez les options',
          'text=Select options',
          'text=options et la quantité',
          'text=options and quantity',
          'button:has-text("options")',
          '[class*="select"]:has-text("Sélectionner")'
        ];
        
        let opened = false;
        for (const sel of trySelectors) {
          try {
            await page.locator(sel).first().click({ timeout: 1500 });
            await page.waitForSelector('[data-testid="sku-panel-sku"][data-show-type="skuPanel"]', { 
              timeout: 2000 
            });
            console.log('[SUCCESS] Panneau ouvert via sélecteur alternatif:', sel);
            opened = true;
            await new Promise(r => setTimeout(r, 1000));
            break;
          } catch (_) { 
            continue;
          }
        }
        
        if (!opened) {
          console.log('[WARN] Impossible d\'ouvrir le panneau SKU avec les sélecteurs disponibles');
        }
      }
    } else {
      console.log('[INFO] Panneau SKU déjà ouvert');
    }
  } catch (error) {
    console.log('[WARN] Erreur lors de l\'ouverture du panneau SKU:', error.message);
  }

  // Extraire les spécifications depuis le panneau
  const specification = await page.evaluate(() => {
    // Normalise en gérant aussi les espaces fines / insécables (\u202F, \u00A0, etc.)
    const norm = (s) => (s || '')
      .replace(/[\u00A0\u202F\u2007\u2009\u200A\uFEFF]/g, ' ')
      .replace(/[\t\n\r]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const onlyDigits = (s) => (s || '').replace(/[^0-9]/g, '');

    const parseMoney = (text) => {
      const t = norm(text || '');
      if (!t) return { amount: null, currency: null, raw: null };
      // Capture la partie numérique et garde la fin comme devise
      const m = t.match(/([0-9][0-9\s,.]*)\s*([^0-9]*)$/);
      if (!m) return { amount: null, currency: null, raw: t };
      const numStr = onlyDigits(m[1]);
      const amount = numStr ? parseInt(numStr, 10) : null;
      const currency = norm(m[2]) || null;
      return { amount, currency, raw: t };
    };

    // Chercher le panneau SKU ouvert
    const skuPanel = document.querySelector('[data-testid="sku-panel-sku"][data-show-type="skuPanel"]');
    
    if (!skuPanel) {
      console.log('[DEBUG] Panneau SKU non trouvé');
      return null;
    }

    // Chercher la zone des spécifications dans le panneau
    const skuInfo = skuPanel.querySelector('[data-testid="sku-info"][data-show-type="skuPanel"]');
    
    if (!skuInfo) {
      console.log('[DEBUG] Zone sku-info non trouvée');
      return null;
    }

    // Trouver le bloc "Spécification"
    const skuList = Array.from(skuInfo.querySelectorAll('[data-testid="sku-list"]'))
      .find(node => /sp[ée]cification/i.test(node.textContent || ''));

    if (!skuList) {
      console.log('[DEBUG] Liste des spécifications non trouvée');
      return null;
    }

    const out = [];

    // Extraire tous les items de spécification
    const lastItems = skuList.querySelectorAll('[data-testid="last-sku-item"]');
    
    if (!lastItems || lastItems.length === 0) {
      console.log('[DEBUG] Aucun item last-sku-item trouvé, tentative avec sku-list-item...');
      
      // Fallback: itérer directement les containers d'items si structure différente
      const items = skuList.querySelectorAll('[data-testid="sku-list-item"]');
      if (items && items.length > 0) {
        items.forEach((item, index) => {
          try {
            const name = norm(item.querySelector('[data-testid="double-bordered-box"] span')?.textContent || '');
            let priceText = item.querySelector('[data-testid="price"]')?.textContent || '';
            if (!priceText) priceText = item.querySelector('[data-testid="price"]')?.getAttribute?.('title') || '';
            const pr = parseMoney(priceText);
            
            if (name) {
              out.push({ 
                index: index + 1,
                name, 
                price: pr.amount, 
                currency: pr.currency, 
                rawPrice: pr.raw 
              });
            }
          } catch (_) {}
        });
      }
      
      return out.length ? out : null;
    }

    console.log('[DEBUG] Nombre d\'items trouvés:', lastItems.length);

    lastItems.forEach((li, index) => {
      try {
        // Nom de la spécification (depuis le double-bordered-box)
        const nameEl = li.querySelector('[data-testid="double-bordered-box"] span');
        const name = norm(nameEl?.textContent || '');

        // Prix
        const priceEl = li.querySelector('[data-testid="price"]');
        let priceText = priceEl?.textContent || '';
        if (!priceText) priceText = priceEl?.getAttribute?.('title') || '';
        const pr = parseMoney(priceText);

        // État sélectionné (class "selected" sur double-bordered-box)
        const boxEl = li.querySelector('[data-testid="double-bordered-box"]');
        const selected = boxEl?.classList.contains('selected') || false;

        // Informations du number picker
        const picker = li.querySelector('[data-testid="number-picker"]');
        const qtyInput = picker?.querySelector('input');
        const qty = qtyInput ? qtyInput.value : null;
        
        const minusBtn = picker?.querySelector('.number-picker-button:first-of-type');
        const plusBtn = picker?.querySelector('.number-picker-button:last-of-type');
        const minusDisabled = minusBtn?.classList.contains('disabled') || false;
        const plusDisabled = plusBtn?.classList.contains('disabled') || false;

        // Bouton/contrôles ARIA
        const controlBtn = li.querySelector('[aria-haspopup="dialog"][aria-controls]');
        const ariaControls = controlBtn?.getAttribute('aria-controls') || null;
        const ariaExpanded = controlBtn?.getAttribute('aria-expanded') || null;

        if (name) {
          out.push({
            index: index + 1,
            name,
            price: pr.amount,
            currency: pr.currency,
            rawPrice: pr.raw,
            selected,
            quantity: qty !== null ? Number(qty) : null,
            numberPicker: {
              present: !!picker,
              minusDisabled,
              plusDisabled
            },
            aria: {
              controls: ariaControls,
              expanded: ariaExpanded
            }
          });
        }
      } catch (err) {
        console.log('[DEBUG] Erreur sur item', index, ':', err.message);
      }
    });

    return out.length ? out : null;
  });

  if (specification && specification.length) {
    console.log('[SUCCESS] Spécifications extraites:', specification.length, 'éléments');
  } else {
    console.log('[INFO] Spécifications absentes ou non détectées');
  }

  // 6) RETOURNER TOUT (JSON plat)
  return {
    success: true,
    url: page.url(),
    pageTitle,
    title: productTitle,
    titleSelector: titleSelector,
    images: images && images.length ? images : [],
    attributes: attributesKV,
    prices,
    specification: specification && specification.length ? specification : 'none'
  };

} catch (error) {
  console.error('[ERROR]', error.message);

  return {
    success: false,
    error: error.message,
    errorType: error.name,
    stack: error.stack.split('\n').slice(0, 3)
  };
}