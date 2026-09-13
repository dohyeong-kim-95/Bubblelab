import { mkdirSync, writeFileSync } from "node:fs";

// 터미널에서 반복 생성할 수 있는 작은 A1 어휘 원본. 뜻과 예문은 영상 생성 전에
// JSON으로 굽는다. 나중에 추천 순서를 바꿔도 이 원본은 학습 콘텐츠의 source다.
const rows = `
hola|안녕|phrase;adiós|잘 가|phrase;gracias|고마워|phrase;por favor|부탁해|phrase;perdón|미안해|phrase;sí|응|phrase;no|아니|phrase;bien|잘|adv;muy|매우|adv;también|또한|adv; aquí|여기|adv; allí|저기|adv;ahora|지금|adv;hoy|오늘|adv;mañana|내일|adv;ayer|어제|adv;siempre|항상|adv;nunca|결코|adv;ya|벌써|adv;todavía|아직|adv;yo|나|pron;tú|너|pron;él|그|pron;ella|그녀|pron;nosotros|우리|pron;ellos|그들|pron;usted|당신|pron;mi|나의|pron;tu|너의|pron;su|그의·그녀의|pron;este|이|det;ese|그|det;qué|무엇|pron;quién|누구|pron;dónde|어디|pron;cuándo|언제|pron;cómo|어떻게|pron;por qué|왜|pron;uno|하나|num;dos|둘|num;tres|셋|num;cuatro|넷|num;cinco|다섯|num;seis|여섯|num;siete|일곱|num;ocho|여덟|num;nueve|아홉|num;diez|열|num;once|열하나|num;doce|열둘|num;primero|첫 번째|num;último|마지막|adj;grande|큰|adj;pequeño|작은|adj;alto|높은|adj;bajo|낮은|adj;bueno|좋은|adj;malo|나쁜|adj;bonito|예쁜|adj;feo|못생긴|adj;nuevo|새로운|adj;viejo|오래된|adj;joven|젊은|adj;rápido|빠른|adj;lento|느린|adj;fácil|쉬운|adj;difícil|어려운|adj;caliente|뜨거운|adj;frío|차가운|adj;feliz|행복한|adj;triste|슬픈|adj;cansado|피곤한|adj;enfermo|아픈|adj;ocupado|바쁜|adj;libre|한가한|adj;importante|중요한|adj;posible|가능한|adj;diferente|다른|adj;igual|같은|adj;rojo|빨간|adj;azul|파란|adj;verde|초록의|adj;blanco|하얀|adj;negro|검은|adj;amarillo|노란|adj;uno|하나|num;persona|사람|noun;hombre|남자|noun;mujer|여자|noun;niño|아이|noun;niña|여자아이|noun;amigo|친구|noun;familia|가족|noun;madre|어머니|noun;padre|아버지|noun;hermano|형제|noun;hermana|자매|noun;hijo|아들|noun;hija|딸|noun;nombre|이름|noun;edad|나이|noun;día|날|noun;semana|주|noun;mes|달|noun;año|년|noun;hora|시간|noun;minuto|분|noun;mañana|아침|noun;tarde|오후|noun;noche|밤|noun;tiempo|시간·날씨|noun;vida|삶|noun;casa|집|noun;habitación|방|noun;puerta|문|noun;ventana|창문|noun;mesa|탁자|noun;silla|의자|noun;cama|침대|noun;escuela|학교|noun;trabajo|일|noun;oficina|사무실|noun;tienda|가게|noun;mercado|시장|noun;ciudad|도시|noun;país|나라|noun;calle|거리|noun;parque|공원|noun;playa|해변|noun;estación|역|noun;hotel|호텔|noun;restaurante|식당|noun;baño|욕실|noun;agua|물|noun;café|커피|noun;té|차|noun;leche|우유|noun;pan|빵|noun;arroz|쌀·밥|noun;carne|고기|noun;pez|물고기|noun;fruta|과일|noun;manzana|사과|noun;plátano|바나나|noun;comida|음식|noun;desayuno|아침 식사|noun;almuerzo|점심|noun;cena|저녁 식사|noun;dinero|돈|noun;libro|책|noun;papel|종이|noun;teléfono|전화|noun;foto|사진|noun;música|음악|noun;película|영화|noun;idioma|언어|noun;palabra|단어|noun;pregunta|질문|noun;respuesta|대답|noun;idea|생각|noun;amor|사랑|noun;ayuda|도움|noun;problema|문제|noun;viaje|여행|noun;sol|해|noun;luna|달|noun;lluvia|비|noun;viento|바람|noun;ir|가다|verb;venir|오다|verb;estar|있다·상태이다|verb;ser|~이다|verb;tener|가지다|verb;hacer|하다|verb;decir|말하다|verb;hablar|말하다|verb;escuchar|듣다|verb;leer|읽다|verb;escribir|쓰다|verb;ver|보다|verb;mirar|바라보다|verb;conocer|알다·만나다|verb;saber|알다|verb;querer|원하다|verb;gustar|좋아하다|verb;amar|사랑하다|verb;necesitar|필요로 하다|verb;buscar|찾다|verb;encontrar|찾아내다|verb;dar|주다|verb;tomar|마시다·잡다|verb;comer|먹다|verb;beber|마시다|verb;comprar|사다|verb;vender|팔다|verb;abrir|열다|verb;cerrar|닫다|verb;entrar|들어가다|verb;salir|나가다|verb;llegar|도착하다|verb;vivir|살다|verb;trabajar|일하다|verb;estudiar|공부하다|verb;aprender|배우다|verb;enseñar|가르치다|verb;dormir|자다|verb;levantarse|일어나다|verb;sentarse|앉다|verb;caminar|걷다|verb;correr|달리다|verb;jugar|놀다|verb;viajar|여행하다|verb;llamar|전화하다|verb;esperar|기다리다|verb;ayudar|돕다|verb;empezar|시작하다|verb;terminar|끝내다|verb;gustar|좋아하다|verb; poder|할 수 있다|verb;deber|해야 한다|verb;con|~와 함께|prep;sin|~없이|prep;para|~을 위해|prep;desde|~부터|prep;hasta|~까지|prep;en|~안에|prep;sobre|~위에·관해|prep;entre|~사이에|prep;y|그리고|conj;o|또는|conj;pero|하지만|conj;porque|왜냐하면|conj;que|~라는 것|conj;el|그|det;la|그|det;los|그들|det;las|그들|det;un|하나의|det;una|하나의|det;mucho|많이|adv;poco|조금|adv;más|더|adv;menos|덜|adv;solo|단지·혼자|adv;otra vez|다시|adv;|`;

const rowsParsed = rows.split(";").map((row) => row.trim()).filter(Boolean).map((row) => {
  const [word, meaning, type] = row.split("|");
  return { word, meaning, type };
}).filter((item, index, all) => item.word && all.findIndex((one) => one.word === item.word) === index).slice(0, 200);

const article = (word) => /^[aeiouáéíóú]/i.test(word) ? "el" : "la";
const exampleOf = ({ word, type }) => {
  if (type === "verb") return `Quiero ${word} hoy.`;
  if (type === "adj") return `Estoy ${word}.`;
  if (type === "noun") return `Veo ${article(word)} ${word}.`;
  return `Hoy aprendo la palabra «${word}».`;
};

const items = rowsParsed.map((item, index) => ({
  id: `a1-${String(index + 1).padStart(3, "0")}`,
  ...item,
  example: exampleOf(item),
}));
if (items.length !== 200) throw new Error(`expected 200 A1 words, got ${items.length}`);
mkdirSync("life/pops/content", { recursive: true });
writeFileSync("life/pops/content/a1-words.json", JSON.stringify({ version: 1, level: "A1", language: "es", items }, null, 2) + "\n");
console.log(`generated ${items.length} A1 words`);
