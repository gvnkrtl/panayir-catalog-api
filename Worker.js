
const ALLOWED_HOSTS = ["https://dizipal12.com.tr/"];
const MAX_PAGES = 15;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: corsHeaders()
  });
}

function decodeHtml(s = "") {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCodePoint(Number(n))
    );
}

function getMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of tags) {
    const name =
      tag.match(/\b(?:property|name)=["']([^"']+)["']/i)?.[1];
    const content =
      tag.match(/\bcontent=["']([^"']*)["']/i)?.[1];

    if (name?.toLowerCase() === escaped.toLowerCase() && content) {
      return decodeHtml(content);
    }
  }
  return "";
}

function getTitle(html) {
  return decodeHtml(
    getMeta(html, "og:title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<[^>]+>/g, "")
      .trim() ||
    ""
  );
}

function getType(title, url) {
  return /dizi|sezon|bölüm|episode|series/i.test(title + " " + url)
    ? "Dizi"
    : "Film";
}

async function fetchText(url) {
  const u = new URL(url);

  if (!["http:", "https:"].includes(u.protocol) ||
      !ALLOWED_HOSTS.includes(u.hostname)) {
    throw new Error("İzin verilmeyen alan adı");
  }

  const response = await fetch(u.href, {
    headers: { "User-Agent": "PanayirCatalogBot/1.0" },
    redirect: "error"
  });

  if (!response.ok) throw new Error("Kaynak HTTP " + response.status);
  return response.text();
}

async function getCatalog() {
  const host = ALLOWED_HOSTS[0];
  const sitemap = `https://${host}/sitemap.xml`;
  const xml = await fetchText(sitemap);

  const urls = [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
    .map(m => decodeHtml(m[1].trim()))
    .filter(raw => {
      try {
        const u = new URL(raw);
        return u.hostname === host &&
          /^https?:$/.test(u.protocol);
      } catch {
        return false;
      }
    })
    .slice(0, MAX_PAGES);

  const items = [];

  for (const url of urls) {
    try {
      const html = await fetchText(url);
      const title = getTitle(html);
      if (!title) continue;

      items.push({
        title,
        type: getType(title, url),
        description:
          getMeta(html, "og:description") ||
          getMeta(html, "description"),
        poster: getMeta(html, "og:image"),
        pageUrl: url
      });
    } catch {
      // Tek bir sayfa hata verirse diğerlerine devam et.
    }
  }

  return {
    ok: true,
    count: items.length,
    items
  };
}

export default {
  async fetch(request) {
    const headers = corsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response(
        "Panayir Catalog API çalışıyor. Katalog için /catalog kullan.",
        { headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" } }
      );
    }

    if (url.pathname !== "/catalog") {
      return json({ ok: false, error: "Endpoint bulunamadı." }, 404);
    }

    try {
      return json(await getCatalog());
    } catch (error) {
      return json({
        ok: false,
        error: "Katalog alınamadı. Alan adını, sitemap.xml dosyasını ve erişim iznini kontrol et."
      }, 502);
    }
  }
};
