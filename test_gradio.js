import { Client } from "@gradio/client";

async function test() {
  console.log("Connecting...");
  const app = await Client.connect("salbiyah/pinang-api");
  console.log("Connected! Fetching API info...");
  const info = await app.view_api();
  console.log(JSON.stringify(info, null, 2));
}
test();
