// The exact text printed on the two fictional scans in public/claims/scans/.
// Used only to render the images (tools/make-scans.mjs) and by the mock model in local tests.
// The real model never sees this file: it reads the images.

export const SCAN_TEXTS = {
  "CL-2026-02755/disch": [
    "NEMOCNICE PODJEŠTĚDÍ",
    "Traumatologické oddělení",
    "Nemocniční 12, Liberec · VZOR, fiktivní dokument",
    "",
    "PROPOUŠTĚCÍ ZPRÁVA",
    "",
    "Pacient: Marek Dvořák   Nar.: 22. 6. 1983",
    "Přijat: 14. 8. 2026   Propuštěn: 16. 8. 2026",
    "",
    "Anamnéza: Dne 14. 8. 2026 ráno pád z kola na cyklostezce, dopad na pravé rameno. Bezvědomí neguje.",
    "Objektivně: deformita v oblasti pravého klíčku, bolestivost při pohybu.",
    "RTG: zlomenina střední třetiny pravé klíční kosti s dislokací.",
    "Diagnóza: S42.0 Zlomenina klíční kosti vpravo",
    "Výkon: 15. 8. 2026 otevřená repozice a osteosyntéza dlahou.",
    "Doporučení: pracovní neschopnost, šátkový závěs, kontrola na ambulanci 30. 8. 2026.",
    "",
    "V Liberci dne 16. 8. 2026",
    "MUDr. Jiří Kolář",
  ].join("\n"),
  "CL-2026-02755/dpn": [
    "POTVRZENÍ O DOČASNÉ PRACOVNÍ NESCHOPNOSTI",
    "VZOR, fiktivní dokument",
    "",
    "Pojištěnec: Marek Dvořák",
    "Den vzniku DPN: 14. 8. 2026",
    "Den ukončení DPN: 25. 9. 2026",
    "Diagnóza: S42.0",
    "Ošetřující lékař: MUDr. Jiří Kolář",
    "Datum vystavení: 26. 9. 2026",
  ].join("\n"),
};
