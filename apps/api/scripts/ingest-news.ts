import { runNewsIngestionJob } from "../lib/jobs/newsIngestion";

async function main() {
  const result = await runNewsIngestionJob();

  console.info("[news:cli] ingestion complete");
  console.info(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("[news:cli] ingestion failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("../lib/prisma");
    await prisma.$disconnect();
  });
