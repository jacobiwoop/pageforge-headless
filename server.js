const express = require("express");
const cors = require("cors");
const multer = require("multer");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------------------
// Multer: réception de fichiers
// -----------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype === "application/javascript" ||
      file.mimetype === "text/javascript" ||
      file.originalname.endsWith(".js")
    ) {
      cb(null, true);
    } else {
      cb(new Error("Seuls les fichiers .js sont acceptés"));
    }
  },
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// -----------------------------
// Browser singleton (réutilisé)
// -----------------------------
let BROWSER = null;
async function getBrowser() {
  if (BROWSER) return BROWSER;

  console.log("[INFO] Lancement du navigateur avec Stealth...");

  BROWSER = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
      "--no-zygote",
      "--single-process",
    ],
    executablePath: process.env.CHROME_PATH || undefined,
    ignoreHTTPSErrors: true,
  });

  BROWSER.on("disconnected", () => {
    console.log("[WARN] Navigateur déconnecté");
    BROWSER = null;
  });

  console.log("[INFO] Navigateur lancé avec succès");
  return BROWSER;
}

// Helper: créer une page avec config anti-détection
async function withPage(
  run,
  { locale = "en-US", userAgent, viewport, blockResources = false } = {},
) {
  const browser = await getBrowser();
  let page;

  try {
    page = await browser.newPage();

    // Configuration viewport
    await page.setViewport(viewport || { width: 1920, height: 1080 });

    // User Agent moderne (Chrome 131)
    await page.setUserAgent(
      userAgent ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );

    // Langue française par défaut pour amazon.fr
    const lang =
      locale === "fr-FR" ? "fr-FR,fr;q=0.9,en;q=0.8" : "en-US,en;q=0.9";

    // Headers HTTP réalistes
    await page.setExtraHTTPHeaders({
      "Accept-Language": lang,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Cache-Control": "max-age=0",
      "Upgrade-Insecure-Requests": "1",
    });

    // Blocage ressources (optionnel, désactivé par défaut pour Alibaba)
    if (blockResources) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const type = req.resourceType();
        const url = req.url();
        if (type === "image" || type === "media" || type === "font") {
          return req.abort();
        }
        if (
          /(google-analytics|doubleclick|googletagmanager|facebook|ads|beacon)/i.test(
            url,
          )
        ) {
          return req.abort();
        }
        return req.continue();
      });
    }

    // Timeout par défaut plus long pour Alibaba
    page.setDefaultTimeout(30000);

    // Masquer traces d'automatisation supplémentaires
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", {
        get: () => false,
      });

      window.navigator.chrome = {
        runtime: {},
      };

      Object.defineProperty(navigator, "plugins", {
        get: () => [1, 2, 3, 4, 5],
      });

      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
      });
    });

    return await run(page);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// -----------------------------
// Routes basiques
// -----------------------------
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "Headless Browser API with Stealth",
    browser: "Puppeteer + Stealth Plugin",
    endpoints: [
      {
        path: "/run",
        method: "POST",
        description: "Exécuter un script (JSON)",
      },
      {
        path: "/run-file",
        method: "POST",
        description: "Exécuter un fichier .js",
      },
      { path: "/health", method: "GET", description: "Vérifier le statut" },
    ],
  });
});

app.get("/health", async (req, res) => {
  try {
    await getBrowser();
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: "error", error: { message: e.message } });
  }
});

// ------------------------------------
// POST /run : exécution depuis JSON
// ------------------------------------
app.post("/run", async (req, res) => {
  const { script, timeout = 60000 } = req.body || {};
  if (!script) {
    return res.status(400).json({
      status: "error",
      error: { message: 'Le champ "script" est requis' },
    });
  }
  await executeScript(script, timeout, res);
});

// ------------------------------------
// POST /run-file : exécution d'un .js
// ------------------------------------
app.post("/run-file", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      status: "error",
      error: {
        message:
          'Aucun fichier reçu. Utilisez le champ "file" pour envoyer un .js',
      },
    });
  }
  const script = req.file.buffer.toString("utf-8");
  const timeout = parseInt(req.body.timeout) || 60000;
  await executeScript(script, timeout, res);
});

// ------------------------------------
// Exécution commune avec réutilisation
// ------------------------------------
async function executeScript(script, timeout, res) {
  console.log("[INFO] Exécution du script utilisateur...");

  try {
    const data = await withPage(async (page) => {
      // Exécuter le script utilisateur (AsyncFunction)
      const AsyncFunction = Object.getPrototypeOf(
        async function () {},
      ).constructor;
      const userFunction = new AsyncFunction("page", "browser", script);

      // Course avec timeout
      const result = await Promise.race([
        userFunction(page, await getBrowser()),
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("Timeout dépassé")), timeout),
        ),
      ]);

      return result;
    });

    console.log("[INFO] Script exécuté avec succès");
    res.json({
      status: "success",
      data: data || { message: "Script exécuté avec succès" },
    });
  } catch (error) {
    console.error("[ERROR]", error);
    res.status(500).json({
      status: "error",
      error: {
        message: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
      },
    });
  }
}

// ------------------------------------
// Gestion des erreurs globales
// ------------------------------------
app.use((err, req, res, next) => {
  console.error("Erreur non gérée:", err);
  res
    .status(500)
    .json({ status: "error", error: { message: "Erreur interne du serveur" } });
});

// ------------------------------------
// Démarrage du serveur
// ------------------------------------
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `🚀 Service Headless Browser avec Stealth démarré sur le port ${PORT}`,
  );
  console.log(`📡 Endpoint principal: POST /run et POST /run-file`);
  console.log(`🛡️ Protection anti-détection: ACTIVÉE`);
});

// Fermeture propre
process.on("SIGTERM", async () => {
  console.log("[INFO] SIGTERM reçu, fermeture du navigateur...");
  if (BROWSER) {
    try {
      await BROWSER.close();
    } catch (_) {}
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("[INFO] SIGINT reçu, fermeture du navigateur...");
  if (BROWSER) {
    try {
      await BROWSER.close();
    } catch (_) {}
  }
  process.exit(0);
});
