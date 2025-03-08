import { AttributeTemplateId, ExistAuthorizer, ExistClient, UpdateAttributeValueParam } from "@leonschreiber96/exist-sdk-typescript/";
import "jsr:@std/dotenv/load";
import { crypto } from "https://deno.land/std@0.119.0/crypto/mod.ts";

const WEBHOOK_SECRET = Deno.env.get("WEBHOOK_SECRET")!;
const EXPECTED_SIGNATURE_VERSION = "1";

if (!Deno.args[0]) console.log("No port specified. Using default port 8080");
const port = +Deno.args[0] || 8080;

console.log(`Starting server on port ${port}...`);

const auth = new ExistAuthorizer(Deno.env.get("EXIST_CLIENT_ID")!, Deno.env.get("EXIST_CLIENT_SECRET")!);
auth.useAuthorizationFile("exist_auth.json");
const client = new ExistClient(auth);

async function getMoneySpent(date: Date): Promise<number> {
   console.log(`Fetching money spent for date: ${date.toISOString()}`);
   const data = await client.attributes.getValuesForAttribute<number>(AttributeTemplateId.MoneySpent, { dateMax: date });
   console.log(`Fetched value: ${data.results[0]?.value ?? 0}`);
   return data.results[0]?.value ?? 0;
}

async function updateMoneySpent(date: Date, value: number): Promise<void> {
   console.log(`Updating money spent for date: ${date.toISOString()} with value: ${value}`);
   await client.attributes.updateValues<number>({name: AttributeTemplateId.MoneySpent, value, date });
   console.log(`Update successful`);
}

function verifySignature(headers: Headers, body: string): boolean {
   console.log("Verifying webhook signature...");
   const signatureHeader = headers.get("signature");
   if (!signatureHeader) {
      console.log("No signature header found");
      return false;
   }

   let timestamp: string | null = null;
   let signatureHash: string | null = null;

   signatureHeader.split(",").forEach(part => {
      if (part.startsWith("t=")) {
         timestamp = part.substring(2);
      }
      if (part.startsWith(`v${EXPECTED_SIGNATURE_VERSION}=`)) {
         signatureHash = part.substring(3).trim();
      }
   });

   if (!timestamp || !signatureHash) {
      console.log("Invalid signature format");
      return false;
   }

   const payload = `${timestamp}.${body}`;
   const calculated = crypto.subtle.digestSync("SHA-256", new TextEncoder().encode(payload + WEBHOOK_SECRET));
   const calculatedHex = Array.from(new Uint8Array(calculated)).map(b => b.toString(16).padStart(2, "0")).join("");
   const isValid = calculatedHex === signatureHash;
   console.log(`Signature valid: ${isValid}`);
   return isValid;
}

Deno.serve({ port: port, hostname: "127.0.0.1" }, async (req: Request) => {
   console.log(`Received request: ${req.method} ${req.url}`);
   const method = req.method;
   if (method !== "POST") {
      console.log("Rejected request: Method not allowed");
      return new Response("Method not allowed", { status: 405 });
   }

   const body = await req.text();
   console.log("Raw request body received:", body);

   if (!verifySignature(req.headers, body)) {
      console.log("Invalid signature, rejecting request");
      return new Response("Invalid signature", { status: 400 });
   }

   const jsonBody = JSON.parse(body);
   console.log("Parsed JSON body:", jsonBody);

   if (jsonBody.password !== Deno.env.get("PASSWORD")) {
      console.log("Unauthorized request, invalid password");
      return new Response("Unauthorized", { status: 401 });
   }

   const spentAmount = jsonBody.spentAmount;
   if (typeof spentAmount !== "number") {
      console.log("Invalid spent amount format");
      return new Response("Invalid spent amount", { status: 400 });
   }
   if (jsonBody.date && isNaN(new Date(jsonBody.date).getTime())) {
      console.log("Invalid date format");
      return new Response("Invalid date", { status: 400 });
   }

   const date = jsonBody.date ? new Date(jsonBody.date) : new Date();
   console.log(`Processing money spent update for date: ${date.toISOString()}`);
   const moneySpent = await getMoneySpent(date);
   await updateMoneySpent(date, 0);
   console.log(`Request processed successfully. New money spent: ${moneySpent + 1}`);
   return new Response(`Money spent: ${moneySpent + 1}`);
});

const date = new Date("2025-03-06");
console.log(`Initializing update for predefined date: ${date.toISOString()}`);
await updateMoneySpent(date, 0);
