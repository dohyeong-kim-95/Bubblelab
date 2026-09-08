import { expect, test } from "@playwright/test";

function minimalPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << >> >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += (index + 1) + " 0 obj\n" + object + "\nendobj\n";
  }
  const xref = Buffer.byteLength(body);
  body += "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  body += offsets.slice(1).map(offset => String(offset).padStart(10, "0") + " 00000 n \n").join("");
  body += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  return Buffer.from(body);
}

test("SKTEST PDF 모드는 첫 진입부터 파일 선택이 가능하다", async ({ page }) => {
  await page.goto("/sktest/workbook/");
  await expect(page.locator("#workbook")).toBeVisible();
  await expect(page.locator("#help-dialog")).not.toHaveAttribute("open", "");

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByText("PDF 선택 / 변경", { exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "연습.pdf",
    mimeType: "application/pdf",
    buffer: minimalPdf(),
  });

  await expect(page.locator("#filename")).toHaveText("연습.pdf");
  await expect(page.locator("#page-total")).toHaveText("/ 1");
  await expect(page.locator("#pdf-canvas")).toBeVisible();
});
