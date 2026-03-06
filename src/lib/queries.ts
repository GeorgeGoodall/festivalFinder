import { prisma } from "./prisma";

export interface SearchParams {
  artist?: string;
  region?: string;
  dateFrom?: string;
  dateTo?: string;
  priceMax?: string;
  camping?: string;
}

export async function searchFestivals(params: SearchParams) {
  const where: any = { status: "published" };

  if (params.region) {
    where.region = params.region;
  }

  if (params.dateFrom) {
    where.startDate = { ...where.startDate, gte: new Date(params.dateFrom) };
  }
  if (params.dateTo) {
    where.endDate = { ...where.endDate, lte: new Date(params.dateTo) };
  }

  if (params.priceMax) {
    where.priceFrom = { lte: parseInt(params.priceMax) };
  }

  if (params.camping === "true") {
    where.hasCamping = true;
  }

  if (params.artist) {
    const artistNames = params.artist
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    if (artistNames.length > 0) {
      where.artists = {
        some: {
          artist: {
            name: { in: artistNames, mode: "insensitive" },
          },
        },
      };
    }
  }

  const festivals = await prisma.festival.findMany({
    where,
    include: {
      artists: {
        include: { artist: true },
        orderBy: { billing: "asc" },
      },
    },
    orderBy: { startDate: "asc" },
  });

  if (params.artist) {
    const artistNames = params.artist
      .split(",")
      .map((a) => a.trim().toLowerCase());
    festivals.sort((a, b) => {
      const aMatches = a.artists.filter((fa) =>
        artistNames.includes(fa.artist.name.toLowerCase())
      ).length;
      const bMatches = b.artists.filter((fa) =>
        artistNames.includes(fa.artist.name.toLowerCase())
      ).length;
      return bMatches - aMatches;
    });
  }

  return festivals;
}

export async function getFeaturedFestivals() {
  return prisma.festival.findMany({
    where: {
      status: "published",
      startDate: { gte: new Date() },
    },
    include: {
      artists: {
        include: { artist: true },
        where: { billing: "headliner" },
      },
    },
    orderBy: { startDate: "asc" },
    take: 6,
  });
}
