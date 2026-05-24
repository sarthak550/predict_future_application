const { PrismaClient } = require("@prisma/client");

const TICKER_MAP = {
  "nifty 50": { instrument: "Nifty 50", ticker: "^NSEI" },
  "nifty50": { instrument: "Nifty 50", ticker: "^NSEI" },
  "bank nifty": { instrument: "Bank Nifty", ticker: "^NSEBANK" },
  "banknifty": { instrument: "Bank Nifty", ticker: "^NSEBANK" },
  "sensex": { instrument: "Sensex", ticker: "^BSESN" },
  "midcap": { instrument: "Nifty Midcap 50", ticker: "^NSEMDCP50" },
  "nifty": { instrument: "Nifty 50", ticker: "^NSEI" },
  "gold": { instrument: "Gold", ticker: "GC=F" },
  "crude": { instrument: "Crude Oil", ticker: "CL=F" },
  "hdfc bank": { instrument: "HDFC Bank", ticker: "HDFCBANK.NS" },
  "icici bank": { instrument: "ICICI Bank", ticker: "ICICIBANK.NS" },
  "reliance": { instrument: "Reliance Industries", ticker: "RELIANCE.NS" },
  "tata motors": { instrument: "Tata Motors", ticker: "TATAMOTORS.NS" },
  "tata steel": { instrument: "Tata Steel", ticker: "TATASTEEL.NS" },
  "tata tech": { instrument: "Tata Technologies", ticker: "TATATECH.NS" },
  "tata consultancy": { instrument: "TCS", ticker: "TCS.NS" },
  "infosys": { instrument: "Infosys", ticker: "INFY.NS" },
  "tcs": { instrument: "TCS", ticker: "TCS.NS" },
  "wipro": { instrument: "Wipro", ticker: "WIPRO.NS" },
  "sbi": { instrument: "State Bank of India", ticker: "SBIN.NS" },
  "state bank": { instrument: "State Bank of India", ticker: "SBIN.NS" },
  "axis bank": { instrument: "Axis Bank", ticker: "AXISBANK.NS" },
  "kotak": { instrument: "Kotak Mahindra Bank", ticker: "KOTAKBANK.NS" },
  "adani": { instrument: "Adani Enterprises", ticker: "ADANIENT.NS" },
  "bharti airtel": { instrument: "Bharti Airtel", ticker: "BHARTIARTL.NS" },
  "airtel": { instrument: "Bharti Airtel", ticker: "BHARTIARTL.NS" },
  "maruti": { instrument: "Maruti Suzuki", ticker: "MARUTI.NS" },
  "asian paints": { instrument: "Asian Paints", ticker: "ASIANPAINT.NS" },
  "hul": { instrument: "Hindustan Unilever", ticker: "HINDUNILVR.NS" },
  "hindustan unilever": { instrument: "Hindustan Unilever", ticker: "HINDUNILVR.NS" },
  "itc": { instrument: "ITC", ticker: "ITC.NS" },
  "larsen": { instrument: "Larsen & Toubro", ticker: "LT.NS" },
  "l&t": { instrument: "Larsen & Toubro", ticker: "LT.NS" },
  "ltimindtree": { instrument: "LTI Mindtree", ticker: "LTIM.NS" },
  "hcl tech": { instrument: "HCL Technologies", ticker: "HCLTECH.NS" },
  "bajaj finance": { instrument: "Bajaj Finance", ticker: "BAJFINANCE.NS" },
  "bajaj auto": { instrument: "Bajaj Auto", ticker: "BAJAJ-AUTO.NS" },
  "ongc": { instrument: "ONGC", ticker: "ONGC.NS" },
  "ntpc": { instrument: "NTPC", ticker: "NTPC.NS" },
  "powergrid": { instrument: "Power Grid", ticker: "POWERGRID.NS" },
  "coal india": { instrument: "Coal India", ticker: "COALINDIA.NS" },
  "ultratech": { instrument: "UltraTech Cement", ticker: "ULTRACEMCO.NS" },
  "grasim": { instrument: "Grasim Industries", ticker: "GRASIM.NS" },
  "sun pharma": { instrument: "Sun Pharma", ticker: "SUNPHARMA.NS" },
  "dr reddy": { instrument: "Dr Reddy's", ticker: "DRREDDY.NS" },
  "cipla": { instrument: "Cipla", ticker: "CIPLA.NS" },
  "lupin": { instrument: "Lupin", ticker: "LUPIN.NS" },
  "auropharma": { instrument: "Aurobindo Pharma", ticker: "AUROPHARMA.NS" },
  "divi's lab": { instrument: "Divi's Laboratories", ticker: "DIVISLAB.NS" },
  "indusind": { instrument: "IndusInd Bank", ticker: "INDUSINDBK.NS" },
  "jswsteel": { instrument: "JSW Steel", ticker: "JSWSTEEL.NS" },
  "jsw steel": { instrument: "JSW Steel", ticker: "JSWSTEEL.NS" },
  "vedanta": { instrument: "Vedanta", ticker: "VEDL.NS" },
  "zomato": { instrument: "Zomato", ticker: "ZOMATO.NS" },
  "paytm": { instrument: "Paytm", ticker: "PAYTM.NS" },
  "nykaa": { instrument: "Nykaa", ticker: "NYKAA.NS" },
};

const prisma = new PrismaClient();

(async () => {
  const ops = await prisma.expertOpinion.findMany({
    where: { instrument: null, suppressedAt: null, isSourceAttribution: false },
    select: { id: true, quote: true, story: { select: { headline: true } } },
  });
  console.log(`Found ${ops.length} opinions with null instrument`);
  let matched = 0;
  for (const op of ops) {
    const text = `${op.story?.headline ?? ""} ${op.quote}`.toLowerCase();
    let hit = null;
    for (const [key, val] of Object.entries(TICKER_MAP)) {
      if (text.includes(key)) {
        hit = val;
        break;
      }
    }
    if (hit) {
      await prisma.expertOpinion.update({
        where: { id: op.id },
        data: { instrument: hit.instrument, instrumentTicker: hit.ticker },
      });
      matched++;
    }
  }
  console.log(`Backfilled ${matched}/${ops.length} via keyword map.`);
  console.log(`Remaining ${ops.length - matched} would need Groq AI fallback (set GROQ_API_KEY + run extractInstrument.ts).`);
  await prisma.$disconnect();
})();
