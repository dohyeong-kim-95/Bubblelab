// 노래에 계속 나오는 낱말. 붙여넣은 가사에서 아는 낱말은 자동으로 뜻이 달린다 —
// 스무 줄 넘는 가사를 한 줄씩 다 번역하다 지쳐 그만두는 것을 막는 게 목적이다.
//
// **가사를 싣지 않는다.** 여기 있는 것은 낱말과 뜻뿐이고, 어느 곡에서 가져온 것도
// 아니다. 특정 노래의 구절이 필요하면 그 곡을 등록해서 직접 적는다(그 사람 브라우저에만 남는다).
//
// 노래 스페인어는 교재와 다르다 — 원형보다 "quiero·dime·vámonos" 처럼 활용된 채
// 나오는 말이 훨씬 잦다. 그래서 원형뿐 아니라 실제로 들리는 꼴을 그대로 담는다.

export const WORDS = {
  /* 마음 */
  amor: "사랑", amar: "사랑하다", amo: "사랑해", amas: "사랑해(너는)", ama: "사랑한다",
  querer: "원하다·사랑하다", quiero: "원해·사랑해", quieres: "원해(너는)", quiere: "원한다",
  corazón: "심장·마음", alma: "영혼", beso: "입맞춤", besos: "입맞춤들", besar: "입맞추다",
  cariño: "애정·자기야", pasión: "열정", deseo: "욕망", ganas: "하고 싶은 마음",
  celos: "질투", locura: "미친 짓", loco: "미친", loca: "미친(여)",
  feliz: "행복한", triste: "슬픈", dolor: "아픔", pena: "슬픔·안타까움",
  miedo: "두려움", sueño: "꿈·잠", sueños: "꿈들", esperanza: "희망",
  suerte: "운", destino: "운명", milagro: "기적",

  /* 사람 */
  yo: "나", tú: "너", él: "그", ella: "그녀", nosotros: "우리", ustedes: "당신들",
  ellos: "그들", me: "나를·나에게", te: "너를·너에게", le: "그에게", nos: "우리를",
  mi: "나의", mis: "나의(복수)", tu: "너의", tus: "너의(복수)", su: "그의·당신의",
  mío: "내 것", mía: "내 것(여)", tuyo: "네 것", tuya: "네 것(여)",
  hombre: "남자", mujer: "여자", chica: "여자애", chico: "남자애", niña: "소녀", niño: "소년",
  gente: "사람들", amigo: "친구", amiga: "친구(여)", novia: "여자친구", novio: "남자친구",
  madre: "어머니", padre: "아버지", mamá: "엄마", papá: "아빠", hermano: "형제", hermana: "자매",
  nadie: "아무도", alguien: "누군가", todos: "모두", solo: "혼자·오직", sola: "혼자(여)",

  /* 몸·감각 */
  ojos: "눈", boca: "입", labios: "입술", manos: "손", mano: "손", piel: "살갗",
  pelo: "머리카락", cara: "얼굴", cuerpo: "몸", voz: "목소리", sangre: "피",

  /* 시간 */
  hoy: "오늘", ayer: "어제", mañana: "내일·아침", noche: "밤", día: "날·하루",
  tarde: "오후·늦은", madrugada: "새벽", siempre: "언제나", nunca: "결코 ~않다",
  ahora: "지금", antes: "전에", después: "후에", ya: "이제·벌써", todavía: "아직",
  aún: "아직", luego: "나중에", pronto: "곧", mientras: "~하는 동안",
  cuando: "~할 때", tiempo: "시간·날씨", vez: "번·차례", veces: "번들", año: "해", años: "해들",
  hora: "시간(시각)", momento: "순간", verano: "여름", invierno: "겨울",

  /* 장소·사물 */
  casa: "집", calle: "거리", ciudad: "도시", mundo: "세상", cielo: "하늘", mar: "바다",
  playa: "해변", luna: "달", sol: "해", estrella: "별", estrellas: "별들",
  agua: "물", fuego: "불", lluvia: "비", viento: "바람", flor: "꽃", camino: "길",
  puerta: "문", cama: "침대", copa: "잔", botella: "병", dinero: "돈", carro: "차",
  canción: "노래", música: "음악", baile: "춤", fiesta: "파티", ritmo: "리듬",

  /* 움직임 */
  ir: "가다", voy: "나는 간다", vas: "너는 간다", va: "간다", vamos: "가자·우리는 간다",
  venir: "오다", ven: "와", vengo: "나는 온다", viene: "온다",
  volver: "돌아오다", vuelve: "돌아와", vuelvo: "나는 돌아간다",
  llegar: "닿다·도착하다", llega: "도착한다", quedar: "머물다", queda: "남는다",
  salir: "나가다", entrar: "들어가다", subir: "오르다", bajar: "내려가다",
  correr: "달리다", caminar: "걷다", bailar: "춤추다", baila: "춤춰", bailo: "나는 춤춘다",
  cantar: "노래하다", canta: "노래해", canto: "나는 노래한다",
  tocar: "만지다·연주하다", mirar: "바라보다", mira: "봐", miro: "나는 본다",
  ver: "보다", veo: "나는 본다", ves: "너는 본다", vi: "나는 봤다", verte: "너를 보는 것",

  /* 말·마음의 움직임 */
  decir: "말하다", dime: "말해줘", digo: "나는 말한다", dice: "말한다", dijo: "말했다",
  hablar: "말하다", habla: "말해", llamar: "부르다·전화하다", llama: "부른다",
  pedir: "부탁하다", dar: "주다", dame: "줘", doy: "나는 준다", da: "준다",
  tener: "가지다", tengo: "나는 가졌다", tienes: "너는 가졌다", tiene: "가졌다",
  saber: "알다", sé: "나는 안다", sabes: "너는 안다", sabe: "안다",
  conocer: "알게 되다", olvidar: "잊다", olvido: "나는 잊는다", olvides: "잊지(마)",
  recordar: "기억하다", recuerdo: "기억·나는 기억한다", pensar: "생각하다", pienso: "나는 생각한다",
  sentir: "느끼다", siento: "느껴·미안해", sientes: "너는 느낀다",
  creer: "믿다", creo: "나는 믿는다", esperar: "기다리다·바라다", espera: "기다려",
  necesitar: "필요하다", necesito: "나는 필요해", buscar: "찾다", busco: "나는 찾는다",
  perder: "잃다", perdí: "나는 잃었다", encontrar: "만나다·찾아내다",
  llorar: "울다", lloro: "나는 운다", reír: "웃다", morir: "죽다", muero: "나는 죽는다",
  vivir: "살다", vivo: "나는 산다", vive: "산다", soñar: "꿈꾸다", sueña: "꿈꿔",
  jurar: "맹세하다", juro: "맹세해", mentir: "거짓말하다", mientes: "너는 거짓말한다",
  perdonar: "용서하다", perdóname: "용서해줘", dejar: "두다·그만두다", deja: "놔둬",
  volar: "날다", beber: "마시다", tomar: "마시다·잡다", comer: "먹다",

  /* 있다·이다 */
  ser: "이다(본질)", soy: "나는 ~이다", eres: "너는 ~이다", es: "~이다", son: "~이다(복수)",
  estar: "있다(상태)", estoy: "나는 ~있다", estás: "너는 ~있다", está: "있다", están: "있다(복수)",
  hay: "~가 있다", fue: "~였다", era: "~였다", había: "있었다", será: "~일 것이다",

  /* 강세 표시 하나로 뜻이 갈리는 짝. 둘 다 담아 둬야 표시를 뺀 가사에서
     엉뚱한 뜻이 붙지 않는다 (el/él, se/sé, mi/mí, mas/más). */
  el: "그 ~(관사)", se: "자기를·서로", mas: "그러나", mí: "나(에게)", aun: "심지어",
  la: "그 ~(관사, 여성)", los: "그 ~(관사, 복수)", las: "그 ~(관사, 여성 복수)",
  un: "한 ~", una: "한 ~(여성)",

  /* 이음말 */
  que: "~것·~라고", qué: "무엇", quien: "~하는 사람", quién: "누구",
  como: "~처럼", cómo: "어떻게", donde: "~하는 곳", dónde: "어디",
  cuándo: "언제", por: "~때문에·~로", para: "~을 위해", porque: "왜냐하면",
  pero: "그러나", aunque: "비록 ~라도", si: "만약", sí: "응·그래", no: "아니·안",
  y: "그리고", o: "또는", ni: "~도 아닌", también: "~도", tampoco: "~도 아니다",
  más: "더", menos: "덜", muy: "아주", tan: "그렇게", tanto: "그만큼", poco: "조금",
  mucho: "많이", nada: "아무것도", todo: "전부", algo: "무언가", otra: "다른(여)", otro: "다른",
  sin: "~없이", con: "~와 함께", conmigo: "나와 함께", contigo: "너와 함께",
  entre: "~사이에", hasta: "~까지", desde: "~부터", sobre: "~위에·~에 대해",
  bien: "잘·좋아", mal: "나쁘게", mejor: "더 나은", peor: "더 나쁜", igual: "마찬가지",
  así: "이렇게", solamente: "오직", casi: "거의", quizás: "아마", acaso: "혹시",

  /* 노래에서 자주 튀는 말 */
  ay: "아이고", oye: "이봐", dale: "자, 해봐", claro: "물론", vale: "좋아",
  venga: "자, 어서", bueno: "음·좋은", ojalá: "제발 ~라면", gracias: "고마워",
  nena: "그대(여)", nene: "그대(남)", rico: "맛있는·좋은", lindo: "예쁜",
  linda: "예쁜(여)", bonita: "예쁜(여)", hermosa: "아름다운(여)", guapo: "잘생긴",
};

/* 낱말 하나로는 뜻이 안 나오는 덩어리. 노래는 이런 말로 굴러간다. */
export const PHRASES = {
  "te quiero": "사랑해", "te amo": "사랑해(더 무겁게)", "mi amor": "내 사랑",
  "mi vida": "내 사랑(직역: 내 인생)", "por favor": "부탁이야",
  "ya no": "이젠 ~않아", "nunca más": "다시는", "otra vez": "다시 한 번",
  "una vez": "한 번", "cada vez": "매번·갈수록", "a veces": "가끔",
  "poco a poco": "조금씩", "tal vez": "어쩌면", "a lo mejor": "아마도",
  "ni siquiera": "~조차 아니다", "por qué": "왜", "porque sí": "그냥 그래서",
  "que te vaya bien": "잘 지내(헤어질 때)", "vete": "가 버려", "déjame": "날 놔둬",
  "no sé": "몰라", "ya sabes": "너도 알잖아", "dime la verdad": "사실대로 말해",
  "sin ti": "너 없이", "junto a mí": "내 곁에", "a mi lado": "내 옆에",
  "toda la noche": "밤새도록", "todo el día": "하루 종일", "para siempre": "영원히",
  "hasta el final": "끝까지", "no puedo": "나는 못 해", "no quiero": "나는 싫어",
  "me muero": "나 죽겠어(그만큼)", "se acabó": "끝났어", "así es": "그런 거야",
  "qué será": "어떻게 될까", "vámonos": "가자", "no me importa": "상관없어",
  "te necesito": "네가 필요해", "vuelve a mí": "내게 돌아와", "bésame": "키스해줘",
  "abrázame": "안아줘", "quédate": "있어줘", "mírame": "날 봐",
};

const STRIP = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" };
const bare = (value) => [...value].map((letter) => STRIP[letter] ?? letter).join("");

/** 표기가 조금 달라도 찾는다 — 강세 표시를 빼먹고 적는 가사가 흔하다. */
export function lookup(word) {
  const key = String(word ?? "").toLowerCase().replace(/[^a-záéíóúüñ']/g, "");
  if (!key) return null;
  if (WORDS[key]) return WORDS[key];
  const target = bare(key);
  for (const [entry, meaning] of Object.entries(WORDS)) {
    if (bare(entry) === target) return meaning;
  }
  return null;
}

/** 한 줄에서 아는 덩어리와 낱말을 뽑는다. 덩어리가 먼저다(긴 것부터). */
export function glossLine(line) {
  const text = String(line ?? "").toLowerCase();
  const phrases = Object.keys(PHRASES)
    .filter((phrase) => text.includes(phrase))
    .sort((a, b) => b.length - a.length)
    .map((phrase) => ({ es: phrase, ko: PHRASES[phrase] }));

  const covered = new Set(phrases.flatMap((entry) => entry.es.split(" ")));
  const seen = new Set();
  const words = [];
  for (const raw of text.match(/[a-záéíóúüñ']+/g) ?? []) {
    if (covered.has(raw) || seen.has(raw)) continue;
    const meaning = lookup(raw);
    if (!meaning) continue;
    seen.add(raw);
    words.push({ es: raw, ko: meaning });
  }
  return [...phrases, ...words];
}

export const WORD_COUNT = Object.keys(WORDS).length + Object.keys(PHRASES).length;
