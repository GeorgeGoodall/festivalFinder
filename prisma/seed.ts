import { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 12);

  await prisma.adminUser.upsert({
    where: { email: "admin@festivalfinder.co.uk" },
    update: {},
    create: {
      email: "admin@festivalfinder.co.uk",
      passwordHash,
      name: "Admin",
    },
  });

  console.log("Seeded admin user: admin@festivalfinder.co.uk / admin123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
