import * as cheerio from "cheerio";

const SOURCE = "https://guiadejogos.com.br";
const CACHE = new Map();
const slug = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const canonical = (s) => slug(s).replace(/-fc$|-ec$|-sc$|-de$|-da$/g,"");
const known = ["ESPN","ESPN 2","ESPN 3","ESPN 4","Disney+","Globo","SporTV","SporTV 2",
  "SporTV 3","Premiere","Paramount+","TNT","Space","HBO Max","Max","CazéTV","GE TV",
  "SBT","Record","Prime Video","Band","BandSports","YouTube","Xsports","SportyNet",
  "NSports","Pluto TV","Apple TV","OneFootball","Canal GOAT","UOL Play"];
async function readPage(url) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 3500);
  try {
    const response = await fetch(url,{signal:ctrl.signal,headers:{"User-Agent":"AJPlayerGuide/1.0 (channel metadata)","Accept":"text/html"}});
    if (!response.ok) return null;
    const html = await response.text();
    return html.length > 400 && html.length < 2_000_000 ? html : null;
  } catch { return null; } finally { clearTimeout(timeout); }
}
function channelsFromHtml(html, home, away) {
  const $ = cheerio.load(html);
  $("script,style,nav,footer").remove();
  const text = $("body").text().replace(/\s+/g," ").trim();
  const normalized = canonical(text);
  if (!normalized.includes(canonical(home)) || !normalized.includes(canonical(away))) return "";
  // Prefer explicit 'Transmissão' metadata, not the site's unrelated channel navigation.
  const marker = /(?:Transmissão|Onde assistir)\s*[:：]?\s*/ig;
  let hit, candidate = "";
  while ((hit = marker.exec(text)) !== null) {
    const nearby = text.slice(hit.index + hit[0].length,hit.index + hit[0].length + 140);
    const channels = known.filter(n => new RegExp(`(^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?![\\p{L}\\p{N}])`,"iu").test(nearby));
    if (channels.length && !/a confirmar|não confirmado/i.test(nearby.slice(0,40))) {
      candidate = [...new Set(channels)].join(" | ");
      break;
    }
  }
  return candidate;
}
async function lookup(match) {
  const date = String(match.kickoff||"").slice(0,10);
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return "";
  const home = slug(match.home), away = slug(match.away);
  if (!home || !away) return "";
  const key = `${home}-${away}-${date}`;
  const existing = CACHE.get(key);
  if (existing && existing.until > Date.now()) return existing.value;
  // Candidate game pages: match by BOTH teams and date; never return guessed channels.
  const candidates = [
    `${SOURCE}/onde-assistir/${home}-vs-${away}-${date}`,
    `${SOURCE}/onde-assistir/${away}-vs-${home}-${date}`
  ];
  let value = "";
  for (const url of candidates) {
    const html = await readPage(url);
    if (html) { value = channelsFromHtml(html,match.home,match.away); if(value) break; }
  }
  CACHE.set(key,{value,until:Date.now()+(value?30:10)*60_000});
  if(CACHE.size>500) CACHE.clear();
  return value;
}
export async function handler(event) {
  if(event.httpMethod!=="POST") return {statusCode:405,body:"POST required"};
  let payload;
  try { payload=JSON.parse(event.body||"{}"); } catch { return {statusCode:400,body:"Invalid JSON"}; }
  const matches=Array.isArray(payload.matches)?payload.matches.slice(0,12):[];
  const channels={};
  // Low concurrency to avoid overloading the source.
  for(let i=0;i<matches.length;i+=4) {
    await Promise.all(matches.slice(i,i+4).map(async m=>{
      if(typeof m.id!=="string"||m.id.length>80) return;
      const result=await lookup(m);
      if(result) channels[m.id]=result;
    }));
  }
  return {statusCode:200,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"},body:JSON.stringify({channels,source:"guiadejogos.com.br"})};
}
