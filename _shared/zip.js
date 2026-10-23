// 무압축(store) ZIP 생성기. 모바일 Safari/Chrome이 한 번의 탭에서 다운로드
// 하나만 허용하므로, 여러 파일은 ZIP 하나로 묶어 내려받는 용도로 쓴다.
// 사용: const blob = window.blMakeZip([{ name: "a.png", data: uint8Array }]);
(() => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  // general purpose bit 11: "파일명은 UTF-8". 이게 없으면 Windows 탐색기 등이
  // 파일명을 CP437/CP949 로 읽어 한글 이름이 깨진다.
  const UTF8_NAME_FLAG = 0x0800;

  window.blMakeZip = function blMakeZip(files) {
    const chunks = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = new TextEncoder().encode(f.name);
      const crc = crc32(f.data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true);
      head.setUint16(6, UTF8_NAME_FLAG, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, f.data.length, true); head.setUint32(22, f.data.length, true);
      head.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(head.buffer), name, f.data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint16(8, UTF8_NAME_FLAG, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, f.data.length, true); cd.setUint32(24, f.data.length, true);
      cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + f.data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  };
})();
