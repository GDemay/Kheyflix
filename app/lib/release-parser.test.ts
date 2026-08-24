import { describe, expect, it } from "vitest";
import { parseReleaseTitle } from "./release-parser";

describe("release title parser", () => {
  it("extracts movie quality without release noise", () => {
    expect(parseReleaseTitle("Star.Wars.Episode.VII.The.Force.Awakens.2015.1080p.BluRay.x265")).toMatchObject({
      displayTitle: "Star Wars Episode VII The Force Awakens",
      year: 2015,
      resolution: "1080p",
      sourceType: "Blu-ray",
      videoCodec: "H.265",
    });
  });

  it("extracts a season pack and German subtitles", () => {
    expect(parseReleaseTitle("Dark Season 2 Complete German Subs 1080p WEB-DL x264")).toMatchObject({
      displayTitle: "Dark",
      season: 2,
      seasonPack: true,
      resolution: "1080p",
      sourceType: "WEB-DL",
      subtitleLanguages: ["German"],
    });
  });

  it("extracts episode ranges", () => {
    expect(parseReleaseTitle("Example.Show.S02E03-E04.720p.HDTV.AV1")).toMatchObject({
      displayTitle: "Example Show",
      season: 2,
      episode: 3,
      episodeEnd: 4,
      resolution: "720p",
      videoCodec: "AV1",
    });
  });

  it("recognizes common subtitle language and VOST tags", () => {
    expect(parseReleaseTitle("Film.2025.1080p.WEB-DL.FRENCH.SUBS").subtitleLanguages).toEqual(["French"]);
    expect(parseReleaseTitle("Serie.S01E02.VOSTFR.EN.SUBS.720p").subtitleLanguages).toEqual(["English", "French"]);
    expect(parseReleaseTitle("Movie.2024.ITA.SUBBED.SPA.SUBS").subtitleLanguages).toEqual(["Spanish", "Italian"]);
  });

  it("recognizes compact multilingual audio tags from real catalog naming", () => {
    expect(parseReleaseTitle("Breaking Bad S05 Complete 1080p ENG-ITA x264 BluRay")).toMatchObject({
      audioLanguages: ["English", "Italian"],
      subtitleLanguages: [],
    });
    expect(parseReleaseTitle("Breaking Bad COMPLETE S01-S05 2160p WEB-DL Rus Ukr Eng DTS-HD MA").audioLanguages)
      .toEqual(["English", "Russian", "Ukrainian"]);
    expect(parseReleaseTitle("Inception 2010 Dual Audio [Hindi 5.1 + English 5.1] 720p").audioLanguages)
      .toEqual(["English", "Hindi"]);
  });

  it("recognizes compact subtitle labels without leaking them into audio", () => {
    expect(parseReleaseTitle("Dune Part Two 2024 NORDiC 1080p BluRay Atmos-NorTekst")).toMatchObject({
      audioLanguages: [],
      subtitleLanguages: ["Norwegian"],
    });
    expect(parseReleaseTitle("Dune Part Two 2024 English 1080p WEBRip x264 ESubs")).toMatchObject({
      audioLanguages: ["English"],
      subtitleLanguages: ["English"],
    });
  });

  it("does not interpret ordinary two-letter title words as audio tags", () => {
    expect(parseReleaseTitle("It 2017 1080p BluRay x264").audioLanguages).toEqual([]);
  });
});
