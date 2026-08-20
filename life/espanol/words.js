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

  /* 레게톤·라틴팝에 특히 잦은 말. 여름·바다·춤·몸짓의 어휘가 몰려 있고,
     축소사(-ito/-ita)와 명령형이 유난히 많다 — 교재에는 잘 안 나오지만
     이 갈래의 노래에서는 뼈대다. */
  despacito: "천천히·살살", despacio: "천천히", suave: "부드러운", suavecito: "아주 살살",
  paso: "걸음", pasito: "작은 걸음", poquito: "아주 조금", besito: "뽀뽀",
  oído: "귀·귓속", oreja: "귀", cuello: "목", hombro: "어깨", cintura: "허리",
  sonrisa: "미소", mirada: "눈빛", aliento: "숨결", latido: "심장 뛰는 소리",
  sudor: "땀", calor: "더위", ropa: "옷", perfume: "향수",
  laberinto: "미로", pared: "벽", lugar: "장소", isla: "섬", arena: "모래", ola: "파도",
  luz: "빛", sombra: "그림자", oscuridad: "어둠", letra: "가사·글자", coro: "후렴",
  tambor: "북", guitarra: "기타",

  /* 몸을 움직이는 말 — 명령형으로 튀어나온다 */
  muévete: "움직여", acércate: "가까이 와", sígueme: "따라와", llévame: "데려가줘",
  pégate: "붙어", sube: "올라와", baja: "내려와", grita: "소리쳐", respira: "숨 쉬어",
  moverse: "움직이다", acercar: "가까이 하다", gritar: "소리치다", respirar: "숨 쉬다",
  abrazar: "안다", abrazo: "포옹", despertar: "깨우다", dormir: "자다",

  /* 계속 나오는 -ando/-iendo (…하면서) */
  bailando: "춤추면서", cantando: "노래하면서", mirando: "바라보면서",
  pensando: "생각하면서", esperando: "기다리면서", llorando: "울면서",
  buscando: "찾으면서", soñando: "꿈꾸면서", sintiendo: "느끼면서",
  hablando: "말하면서", diciendo: "말하면서", haciendo: "하면서",
  queriendo: "원하면서", viviendo: "살면서", muriendo: "죽어가면서",
  corriendo: "달리면서", durmiendo: "자면서", tocando: "만지면서·연주하면서",
  besando: "입맞추면서", amando: "사랑하면서", jugando: "놀면서",
  riendo: "웃으면서", volviendo: "돌아오면서", yendo: "가면서",
  llevando: "데려가면서", dando: "주면서", viendo: "보면서", teniendo: "가진 채",
  saliendo: "나가면서", llegando: "닿으면서", dejando: "놔두면서",
  perdiendo: "잃으면서", recordando: "기억하면서", olvidando: "잊으면서",

  /* 나머지 자주 쓰는 동사·상태 */
  gustar: "마음에 들다", gusta: "마음에 든다", encanta: "아주 좋아한다",
  poder: "할 수 있다", puedo: "나는 할 수 있다", puedes: "너는 할 수 있다", puede: "할 수 있다",
  hacer: "하다", hago: "나는 한다", hace: "한다", haz: "해라",
  poner: "놓다", pon: "놔", llevar: "데려가다·입다", ganar: "이기다·얻다",
  empezar: "시작하다", empieza: "시작한다", seguir: "계속하다", sigue: "계속해",
  terminar: "끝내다", acabar: "끝나다", probar: "맛보다·해 보다", pasar: "지나가다·일어나다",
  peligro: "위험", peligroso: "위험한", prohibido: "금지된", secreto: "비밀",
  tranquilo: "괜찮아·느긋한", favorito: "가장 좋아하는", mismo: "같은",
  aquí: "여기", ahí: "거기", allá: "저기", arriba: "위로", abajo: "아래로",
  cerca: "가까이", lejos: "멀리", toda: "전부(여성)",

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
  "me gusta": "나는 좋아해", "me encanta": "너무 좋아해", "ven aquí": "이리 와",
  "más despacio": "더 천천히",
};

const STRIP = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" };
const bare = (value) => [...value].map((letter) => STRIP[letter] ?? letter).join("");

/** 사전에서 곧바로 찾는다. 표시를 빼먹고 적는 가사가 흔해 표시 없이도 맞춰 본다. */
function direct(key) {
  if (WORDS[key]) return WORDS[key];
  const target = bare(key);
  for (const [entry, meaning] of Object.entries(WORDS)) {
    if (bare(entry) === target) return meaning;
  }
  return null;
}

/* 스페인어는 목적격 대명사를 동사 뒤에 붙여 한 낱말로 쓴다 — 원형·현재분사·명령형에서.
 * mirándote = mirando + te, dármelo = dar + me + lo. 조합이 사실상 무한해서 낱말로
 * 다 담을 수 없다. 떼어 내고 각각을 찾는다 — 붙을 때 생기는 강세 표시
 * (mirando → mirándo…)는 표시를 무시하는 비교가 흡수한다. */
const CLITICS = {
  me: "나를", te: "너를", se: "자기를", nos: "우리를", os: "너희를",
  lo: "그것을", la: "그것을", los: "그것들을", las: "그것들을",
  le: "그에게", les: "그들에게",
};
// 어간이 이보다 짧으면 낱말이 아니라 우연이다 (clase 의 "se" 를 떼지 않는다).
const STEM_MIN = 3;

function splitClitics(key) {
  const names = Object.keys(CLITICS);
  // 두 개 붙은 것(dármelo)부터 본다. 하나만 떼면 남은 것이 어간에 섞인다.
  const tails = [];
  for (const first of names) {
    for (const second of names) tails.push([first + second, [first, second]]);
    tails.push([first, [first]]);
  }
  tails.sort((a, b) => b[0].length - a[0].length);
  for (const [tail, parts] of tails) {
    if (!key.endsWith(tail)) continue;
    const stem = key.slice(0, -tail.length);
    if (stem.length < STEM_MIN) continue;
    const meaning = direct(stem);
    // 어간이 사전에 있을 때만 쪼갠 것으로 친다 — 없으면 그냥 모르는 낱말이다.
    if (meaning) return `${meaning} + ${parts.map((part) => CLITICS[part]).join(" + ")}`;
  }
  return null;
}

/** 표기가 조금 달라도 찾는다 — 강세 표시를 빼먹고 적는 가사가 흔하다. */
export function lookup(word) {
  const key = String(word ?? "").toLowerCase().replace(/[^a-záéíóúüñ']/g, "");
  if (!key) return null;
  return direct(key) ?? splitClitics(key);
}

const LETTER = /[a-záéíóúüñ]/;

/**
 * 덩어리가 낱말 안에 묻혀 있는 것은 찾은 것이 아니다 — muévete 안의 "vete" 를
 * 잡으면 "가 버려" 라는 엉뚱한 뜻이 붙는다. 앞뒤가 글자면 넘어간다.
 */
function hasPhrase(text, phrase) {
  for (let from = 0; ; from += 1) {
    const at = text.indexOf(phrase, from);
    if (at < 0) return false;
    const before = text[at - 1];
    const after = text[at + phrase.length];
    if (!LETTER.test(before ?? " ") && !LETTER.test(after ?? " ")) return true;
    from = at;
  }
}

/** 한 줄에서 아는 덩어리와 낱말을 뽑는다. 덩어리가 먼저다(긴 것부터). */
export function glossLine(line) {
  const text = String(line ?? "").toLowerCase();
  const phrases = Object.keys(PHRASES)
    .filter((phrase) => hasPhrase(text, phrase))
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
