import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.ADMIN_SEED_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.upsert({
    where: { email: "admin@festivalfinder.co.uk" },
    update: {},
    create: {
      email: "admin@festivalfinder.co.uk",
      passwordHash,
      name: "Admin",
    },
  });

  if (process.env.NODE_ENV !== "production") {
    console.log(`Seeded admin user: admin@festivalfinder.co.uk / ${password}`);
  } else {
    console.log("Seeded admin user: admin@festivalfinder.co.uk");
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
