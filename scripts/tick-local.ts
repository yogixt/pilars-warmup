/**
 * Run one warm-up tick locally (sends due emails + processes due replies)
 * without deploying. Useful for smoke-testing the pool.  npm run tick
 */
import { config as dotenv } from "dotenv";
dotenv({ path: ".env.local" });
dotenv();
import { runPendingReplies, runImapSweep, runSends, runAgentMailReplies, stats } from "../lib/warmup";

async function main() {
  const replies = await runPendingReplies();
  const imap = await runImapSweep();
  const agentmail = await runAgentMailReplies();
  const sends = await runSends();
  console.log("tick result:", { repliesSent: replies.replied, imap, agentmail, sends });
  console.log("stats:", await stats());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
