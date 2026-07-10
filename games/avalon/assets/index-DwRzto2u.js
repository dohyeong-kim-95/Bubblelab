(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const n of a)if(n.type==="childList")for(const i of n.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&s(i)}).observe(document,{childList:!0,subtree:!0});function e(a){const n={};return a.integrity&&(n.integrity=a.integrity),a.referrerPolicy&&(n.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?n.credentials="include":a.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function s(a){if(a.ep)return;a.ep=!0;const n=e(a);fetch(a.href,n)}})();class Tt{constructor(){this.routes={},this.currentView=null,window.addEventListener("hashchange",()=>this.handleRoute())}addRoute(t,e){this.routes[t]=e}handleRoute(){const t=window.location.hash||"#/",[e,...s]=t.slice(2).split("/"),a="/"+e,n=s.join("/");this.currentView&&typeof this.currentView.destroy=="function"&&this.currentView.destroy();const i=this.routes[a]||this.routes["/"];i&&(this.currentView=i(n),this.currentView.render())}navigate(t){window.location.hash="#"+t}start(){this.handleRoute()}}const R=new Tt,xt={},_t="avalon";function Lt(){const l=xt?.VITE_RT_HOST||location.host;return`${location.protocol==="http:"?"ws":"wss"}://${l}/_rt/${_t}`}const Rt=l=>(l||"").split("/").filter(Boolean).join("/");let G=null,q=null,Mt=1;const F=new Map,Y=new Map,ct=new Map;function Et(l){return{val:()=>l===void 0?null:l,exists:()=>l!=null}}function Ot(l){if(l.id&&F.has(l.id)){const{resolve:t,reject:e}=F.get(l.id);F.delete(l.id),l.ok?t(l.value):e(new Error(l.error||"request failed"));return}if(l.ev==="v"){const t=Y.get(l.path);if(t)for(const e of[...t])e(Et(l.value))}}function et(l){G&&G.readyState===WebSocket.OPEN&&G.send(JSON.stringify(l))}function at(){return q||(q=new Promise((l,t)=>{const e=new WebSocket(Lt());let s=!1;e.onopen=()=>{s=!0,G=e;for(const a of Y.keys())et({op:"sub",path:a});for(const[a,n]of ct)et({op:"ondisc",path:a,value:n});l()},e.onmessage=a=>{try{Ot(JSON.parse(a.data))}catch{}},e.onclose=()=>{G=null,q=null;for(const{reject:a}of F.values())a(new Error("connection closed"));F.clear(),s&&setTimeout(()=>at().catch(()=>{}),1e3+Math.random()*1e3)},e.onerror=()=>{s||t(new Error("realtime server unreachable"))}}),q)}async function j(l){return await at(),new Promise((t,e)=>{const s=Mt++;F.set(s,{resolve:t,reject:e}),G.send(JSON.stringify({id:s,...l}))})}const m={};async function kt(){await at();let l=localStorage.getItem("avalon_uid");return l||(l="u_"+crypto.randomUUID().replace(/-/g,"").slice(0,20),localStorage.setItem("avalon_uid",l)),l}function d(l,t=""){return{path:Rt(t)}}async function E(l){const t=await j({op:"get",path:l.path});return Et(t)}async function _(l,t){await j({op:"set",path:l.path,value:t})}async function f(l,t){await j({op:"update",path:l.path,value:t})}async function S(l){await j({op:"set",path:l.path,value:null})}let At=0;async function Pt(l,t){const e=Date.now().toString(36)+"_"+(At++).toString(36)+Math.random().toString(36).slice(2,6),s=`${l.path}/${e}`;return await j({op:"set",path:s,value:t}),{path:s,key:e}}function M(l,t){let e=Y.get(l.path);return e||(e=new Set,Y.set(l.path,e)),e.add(t),at().then(()=>et({op:"sub",path:l.path})).catch(()=>{}),()=>{e.delete(t),e.size===0&&(Y.delete(l.path),et({op:"unsub",path:l.path}))}}function Bt(l){return{set:async t=>{ct.set(l.path,t),await j({op:"ondisc",path:l.path,value:t})},cancel:async()=>{ct.delete(l.path),await j({op:"canceldisc",path:l.path})}}}const X={5:{good:3,evil:2},6:{good:4,evil:2},7:{good:4,evil:3},8:{good:5,evil:3},9:{good:6,evil:3},10:{good:6,evil:4}},D={5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]};function ut(l,t){return t===3&&l>=7?2:1}const g={LOYAL_SERVANT:"loyal_servant",MERLIN:"merlin",PERCIVAL:"percival",MINION:"minion",ASSASSIN:"assassin",MORGANA:"morgana",MORDRED:"mordred",OBERON:"oberon"},st={[g.LOYAL_SERVANT]:{name:"충성스러운 기사",team:"good",description:"특수 능력 없음. 토론과 추론으로 플레이"},[g.MERLIN]:{name:"멀린",team:"good",description:"악의 세력 전원을 앎 (모드레드 제외). 들키면 암살당함"},[g.PERCIVAL]:{name:"퍼시벌",team:"good",description:"멀린과 모르가나를 알지만 구분 불가"},[g.MINION]:{name:"모드레드의 하수인",team:"evil",description:"악의 세력 동료를 앎"},[g.ASSASSIN]:{name:"암살자",team:"evil",description:"선 진영 3승 시 멀린을 지목할 권한"},[g.MORGANA]:{name:"모르가나",team:"evil",description:"퍼시벌에게 멀린처럼 보임"},[g.MORDRED]:{name:"모드레드",team:"evil",description:"멀린에게 보이지 않음"},[g.OBERON]:{name:"오베론",team:"evil",description:"다른 악의 세력과 서로 모름. 완전한 고립"}},dt=5,pt=3,K=5,z=10,Vt=[{label:"없음",value:0},{label:"20분",value:1200},{label:"30분",value:1800},{label:"40분",value:2400}];function N(l,t){if(!l)return 0;switch(t){case h.ROLE_REVEAL:return Math.max(15,Math.round(l*.05));case h.TEAM_PROPOSAL:return Math.max(20,Math.round(l*.08));case h.VOTING:return Math.max(15,Math.round(l*.04));case h.VOTE_RESULT:return Math.max(8,Math.round(l*.02));case h.MISSION:return Math.max(10,Math.round(l*.03));case h.MISSION_RESULT:return Math.max(8,Math.round(l*.02));case h.ASSASSINATION:return Math.max(30,Math.round(l*.06));default:return 0}}const h={ROLE_REVEAL:"role_reveal",TEAM_PROPOSAL:"team_proposal",VOTING:"voting",VOTE_RESULT:"vote_result",MISSION:"mission",MISSION_RESULT:"mission_result",ASSASSINATION:"assassination",RESULT:"result"},mt=["morgana","mordred","oberon"];function W(l,t={}){const e=X[l]?.evil||2,s=Math.max(0,e-1),a={merlin:!0,percival:!!t.percival,morgana:!!t.morgana,mordred:!!t.mordred,oberon:!!t.oberon},n=mt.filter(o=>a[o]),i=new Set(n.slice(0,s));for(const o of mt)a[o]=i.has(o);return a}function Nt(l){const t=X[l]?.evil||2;return Math.max(0,t-1)}function Ht(l={}){return mt.filter(t=>!!l[t]).length}function jt(){const l="ABCDEFGHJKLMNPQRSTUVWXYZ";let t="";for(let e=0;e<6;e++)t+=l[Math.floor(Math.random()*l.length)];return t}function yt(l){return(l||"").trim().toLowerCase()}class A{static async _cleanupStaleRooms(){try{const t=await E(d(m,"rooms"));if(!t.exists())return;const e=t.val(),s=Date.now(),a=7200*1e3,n={};for(const[i,o]of Object.entries(e)){const r=o.meta?.createdAt||0,c=o.meta?.status;(s-r>a||c==="finished"&&s-r>1800*1e3)&&(n[`rooms/${i}`]=null,n[`privateData/${i}`]=null)}Object.keys(n).length>0&&await f(d(m),n)}catch{}}static async createRoom(t,e){await this._cleanupStaleRooms();let s,a=0;do{if(s=jt(),!(await E(d(m,`rooms/${s}`))).exists())break;a++}while(a<10);if(a>=10)throw new Error("방 코드 생성에 실패했습니다.");const n={meta:{hostId:t,createdAt:Date.now(),status:"waiting",timeLimitSeconds:1800,voteHistoryEnabled:!0,voteMode:"anonymous",roleConfig:{merlin:!0,percival:!0,morgana:!0,mordred:!1,oberon:!1}},players:{[t]:{name:e,joinedAt:Date.now(),online:!0,order:0}}};return await _(d(m,`rooms/${s}`),n),s}static async joinRoom(t,e,s){const a=d(m,`rooms/${t}`),n=await E(a);if(!n.exists())throw new Error("존재하지 않는 방 코드입니다.");const i=n.val();if(i.meta.status!=="waiting")throw new Error("이미 게임이 시작된 방입니다.");const o=i.players||{},r=Object.keys(o).length,c=yt(s);if(Object.entries(o).some(([p,v])=>p!==e&&yt(v?.name)===c))throw new Error("이미 사용 중인 닉네임입니다.");if(o[e]){await f(d(m,`rooms/${t}/players/${e}`),{name:s,online:!0});return}if(r>=z)throw new Error("방이 가득 찼습니다. (최대 10명)");await _(d(m,`rooms/${t}/players/${e}`),{name:s,joinedAt:Date.now(),online:!0,order:r})}static async leaveRoom(t,e){const s=await E(d(m,`rooms/${t}`));if(!s.exists())return;const a=s.val(),n=a.players||{},i=Object.keys(n).length,o=a.meta?.hostId===e;if(i<=1){o?(await S(d(m,`rooms/${t}`)),await S(d(m,`privateData/${t}`))):await S(d(m,`rooms/${t}/players/${e}`));return}if(o){const c=Object.keys(n).filter(u=>u!==e)[0];await f(d(),{[`rooms/${t}/players/${e}`]:null,[`rooms/${t}/meta/hostId`]:c})}else await S(d(m,`rooms/${t}/players/${e}`))}static async updateRoleConfig(t,e){const s=await this.getRoomData(t),a=Object.keys(s?.players||{}).length;await f(d(m,`rooms/${t}/meta`),{roleConfig:W(a,e)})}static async kickPlayer(t,e,s){const a=await this.getRoomData(t);if(a){if(a.meta?.hostId!==e)throw new Error("방장만 강제 퇴장시킬 수 있습니다.");if(s===e)throw new Error("방장은 자신을 강제 퇴장시킬 수 없습니다.");if(a.meta?.status!=="waiting")throw new Error("강제 퇴장은 대기실에서만 가능합니다.");await f(d(),{[`rooms/${t}/players/${s}`]:null,[`rooms/${t}/readyStatus/${s}`]:null})}}static async updateTimeLimit(t,e){await f(d(m,`rooms/${t}/meta`),{timeLimitSeconds:e})}static async updateVoteHistoryEnabled(t,e){await f(d(m,`rooms/${t}/meta`),{voteHistoryEnabled:e})}static async updateVoteMode(t,e){await f(d(m,`rooms/${t}/meta`),{voteMode:e})}static async getRoomData(t){const e=await E(d(m,`rooms/${t}`));return e.exists()?e.val():null}static onRoomChange(t,e){return M(d(m,`rooms/${t}`),s=>{e(s.val())})}static onPlayersChange(t,e){return M(d(m,`rooms/${t}/players`),s=>{e(s.val()||{})})}static onGameStateChange(t,e){return M(d(m,`rooms/${t}/gameState`),s=>{e(s.val())})}static async deleteRoom(t){await S(d(m,`rooms/${t}`)),await S(d(m,`privateData/${t}`))}}class Dt{constructor(){this.container=document.getElementById("app")}render(){this.container.innerHTML=`
      <div class="view home-view fade-in">
        <div class="home-hero">
          <div class="home-emblem">
            <svg viewBox="0 0 100 120" class="emblem-svg">
              <polygon points="50,5 95,30 95,90 50,115 5,90 5,30" fill="none" stroke="var(--color-gold)" stroke-width="2"/>
              <polygon points="50,15 85,35 85,85 50,105 15,85 15,35" fill="var(--color-bg-card)" stroke="var(--color-gold)" stroke-width="1" opacity="0.5"/>
              <text x="50" y="55" text-anchor="middle" fill="var(--color-gold)" font-size="20" font-weight="bold">A</text>
              <text x="50" y="75" text-anchor="middle" fill="var(--color-text-secondary)" font-size="8">AVALON</text>
            </svg>
          </div>
          <h1 class="home-title">The Resistance: Avalon</h1>
          <p class="home-subtitle">사회자 없이 플레이하는 아발론</p>
        </div>

        <div class="home-actions">
          <button class="btn btn-primary btn-full" id="btn-create">
            방 만들기
          </button>
          <button class="btn btn-outline btn-full" id="btn-join">
            방 참가하기
          </button>
        </div>

        <div class="home-info">
          <p>5~10명 | 약 30~45분</p>
        </div>

        <!-- 방 만들기 모달 -->
        <div class="modal-overlay" id="modal-create" style="display:none">
          <div class="modal">
            <h2 class="modal-title">방 만들기</h2>
            <div class="flex-col gap-md">
              <div>
                <label class="input-label">닉네임</label>
                <input class="input" id="input-create-name" type="text"
                  placeholder="닉네임 입력 (1~8자)" maxlength="8" autocomplete="off" />
              </div>
              <button class="btn btn-primary btn-full" id="btn-create-confirm">방 생성</button>
              <button class="btn btn-outline btn-full" id="btn-create-cancel">취소</button>
            </div>
          </div>
        </div>

        <!-- 방 참가 모달 -->
        <div class="modal-overlay" id="modal-join" style="display:none">
          <div class="modal">
            <h2 class="modal-title">방 참가하기</h2>
            <div class="flex-col gap-md">
              <div>
                <label class="input-label">방 코드</label>
                <input class="input room-code-input" id="input-room-code" type="text"
                  placeholder="6자리 코드 입력" maxlength="6" autocomplete="off"
                  style="text-transform: uppercase; letter-spacing: 0.2em; text-align: center;" />
              </div>
              <div>
                <label class="input-label">닉네임</label>
                <input class="input" id="input-join-name" type="text"
                  placeholder="닉네임 입력 (1~8자)" maxlength="8" autocomplete="off" />
              </div>
              <button class="btn btn-primary btn-full" id="btn-join-confirm">참가</button>
              <button class="btn btn-outline btn-full" id="btn-join-cancel">취소</button>
            </div>
          </div>
        </div>

        <!-- 에러 토스트 -->
        <div class="toast" id="toast" style="display:none">
          <span id="toast-message"></span>
        </div>
      </div>
    `,this.bindEvents(),this.restoreName()}restoreName(){const t=y.playerName||"",e=document.getElementById("input-create-name"),s=document.getElementById("input-join-name");e&&(e.value=t),s&&(s.value=t)}bindEvents(){document.getElementById("btn-create").addEventListener("click",()=>{document.getElementById("modal-create").style.display="flex",document.getElementById("input-create-name").focus()}),document.getElementById("btn-create-cancel").addEventListener("click",()=>{document.getElementById("modal-create").style.display="none"}),document.getElementById("btn-create-confirm").addEventListener("click",()=>this.handleCreate()),document.getElementById("input-create-name").addEventListener("keydown",t=>{t.key==="Enter"&&this.handleCreate()}),document.getElementById("btn-join").addEventListener("click",()=>{document.getElementById("modal-join").style.display="flex",document.getElementById("input-room-code").focus()}),document.getElementById("btn-join-cancel").addEventListener("click",()=>{document.getElementById("modal-join").style.display="none"}),document.getElementById("btn-join-confirm").addEventListener("click",()=>this.handleJoin()),document.getElementById("input-join-name").addEventListener("keydown",t=>{t.key==="Enter"&&this.handleJoin()}),document.getElementById("modal-create").addEventListener("click",t=>{t.target.classList.contains("modal-overlay")&&(t.target.style.display="none")}),document.getElementById("modal-join").addEventListener("click",t=>{t.target.classList.contains("modal-overlay")&&(t.target.style.display="none")}),document.getElementById("input-room-code").addEventListener("input",t=>{t.target.value=t.target.value.toUpperCase().replace(/[^A-Z]/g,"")})}validateName(t){const e=t.trim();return!e||e.length<1||e.length>8?(this.showToast("닉네임은 1~8자로 입력해 주세요."),null):e}async handleCreate(){const t=document.getElementById("input-create-name"),e=this.validateName(t.value);if(!e)return;const s=document.getElementById("btn-create-confirm");s.disabled=!0,s.textContent="생성 중...";try{y.playerName=e,localStorage.setItem("avalon_playerName",e);const a=await A.createRoom(y.playerId,e);y.roomCode=a,R.navigate("/lobby/"+a)}catch(a){console.error("방 생성 실패:",a),this.showToast("방 생성에 실패했습니다. 다시 시도해 주세요."),s.disabled=!1,s.textContent="방 생성"}}async handleJoin(){const t=document.getElementById("input-room-code"),e=document.getElementById("input-join-name"),s=t.value.trim().toUpperCase();if(!s||s.length!==6){this.showToast("6자리 방 코드를 입력해 주세요.");return}const a=this.validateName(e.value);if(!a)return;const n=document.getElementById("btn-join-confirm");n.disabled=!0,n.textContent="참가 중...";try{y.playerName=a,localStorage.setItem("avalon_playerName",a),await A.joinRoom(s,y.playerId,a),y.roomCode=s,R.navigate("/lobby/"+s)}catch(i){console.error("방 참가 실패:",i),this.showToast(i.message||"방 참가에 실패했습니다."),n.disabled=!1,n.textContent="참가"}}showToast(t){const e=document.getElementById("toast"),s=document.getElementById("toast-message");s.textContent=t,e.style.display="flex",setTimeout(()=>{e.style.display="none"},3e3)}destroy(){}}class P{static _disconnectRefs=new Map;static setupPresence(t,e){const s=d(m,`rooms/${t}/players/${e}/online`),a=Bt(s);a.set(!1),_(s,!0),this._disconnectRefs.set(`${t}_${e}`,a)}static async cancelPresence(t,e){const s=`${t}_${e}`,a=this._disconnectRefs.get(s);a&&(await a.cancel(),this._disconnectRefs.delete(s))}static onPrivateDataChange(t,e,s){return M(d(m,`privateData/${t}/${e}`),a=>{s(a.val())})}static async getPrivateData(t,e){const s=await E(d(m,`privateData/${t}/${e}`));return s.exists()?s.val():null}static async submitVote(t,e,s){await _(d(m,`rooms/${t}/actions/votes/${e}`),{vote:s,submittedAt:Date.now()})}static async submitMissionCard(t,e,s){await _(d(m,`rooms/${t}/actions/missionCards/${e}`),{card:s,submittedAt:Date.now()})}static async submitReady(t,e){await _(d(m,`rooms/${t}/actions/readyPlayers/${e}`),!0)}static async submitAssassination(t,e){await _(d(m,`rooms/${t}/actions/assassination/targetId`),e)}}function nt(l){const t=[...l];for(let e=t.length-1;e>0;e--){const s=Math.floor(Math.random()*(e+1));[t[e],t[s]]=[t[s],t[e]]}return t}class ht{static assignRoles(t,e){const s=t.length,{good:a,evil:n}=X[s],i=[];for(e.merlin&&i.push(g.ASSASSIN),e.morgana&&i.push(g.MORGANA),e.mordred&&i.push(g.MORDRED),e.oberon&&i.push(g.OBERON),i.length>n&&(i.length=n);i.length<n;)i.push(g.MINION);const o=[];for(e.merlin&&o.push(g.MERLIN),e.percival&&e.merlin&&o.push(g.PERCIVAL);o.length<a;)o.push(g.LOYAL_SERVANT);const r=nt([...o,...i]),c=nt(t),u={};return c.forEach((p,v)=>{u[p]={role:r[v],team:st[r[v]].team}}),ht.generateVisibleInfo(u)}static generateVisibleInfo(t){const e=Object.entries(t);e.filter(([,o])=>o.team==="evil").map(([o])=>o);const s=e.filter(([,o])=>o.team==="evil"&&o.role!==g.OBERON).map(([o])=>o),a=e.filter(([,o])=>o.team==="evil"&&o.role!==g.MORDRED).map(([o])=>o),n=e.find(([,o])=>o.role===g.MERLIN),i=e.find(([,o])=>o.role===g.MORGANA);for(const[o,r]of e)switch(r.role){case g.MERLIN:r.visibleInfo=a.map(c=>({id:c,label:"evil"}));break;case g.PERCIVAL:r.visibleInfo=[],n&&r.visibleInfo.push({id:n[0],label:"merlin_or_morgana"}),i&&r.visibleInfo.push({id:i[0],label:"merlin_or_morgana"}),r.visibleInfo=nt(r.visibleInfo);break;case g.OBERON:r.visibleInfo=[];break;case g.ASSASSIN:case g.MORGANA:case g.MORDRED:case g.MINION:r.visibleInfo=s.filter(c=>c!==o).map(c=>({id:c,label:"evil_ally"}));break;case g.LOYAL_SERVANT:default:r.visibleInfo=[];break}return t}}class Z{static async clearVotes(t){await S(d(m,`rooms/${t}/actions/votes`))}static onVotesChange(t,e,s){return M(d(m,`rooms/${t}/actions/votes`),a=>{const n=a.val()||{},i=e.every(o=>n[o]);s(n,i)})}static tallyVotes(t){let e=0,s=0;for(const[,a]of Object.entries(t))a.vote==="approve"?e++:s++;return{approved:e>s,approveCount:e,rejectCount:s}}}function Gt(l,t,e){let s=0,a=0;for(const o of Object.values(l||{}))o.card==="success"?s++:a++;const n=ut(t,e);return{success:a<n,successCount:s,failCount:a}}class it{static async clearMissionCards(t){await S(d(m,`rooms/${t}/actions/missionCards`))}static onMissionCardsChange(t,e,s){return M(d(m,`rooms/${t}/actions/missionCards`),a=>{const n=a.val()||{},i=e.every(o=>n[o]);s(n,i)})}static judgeMission(t,e,s){return Gt(t,e,s)}}class ot{static async clearAssassination(t){await S(d(m,`rooms/${t}/actions/assassination`))}static onAssassinationChange(t,e){return M(d(m,`rooms/${t}/actions/assassination`),s=>{const a=s.val();e(a)})}static judgeAssassination(t,e){const s=e[t];return{validTarget:!!s&&s.team==="good",merlinKilled:!!s&&s.team==="good"&&s.role===g.MERLIN}}}function vt(l){const t=[...l];for(let e=t.length-1;e>0;e--){const s=Math.floor(Math.random()*(e+1));[t[e],t[s]]=[t[s],t[e]]}return t}class St{constructor(t){this.roomCode=t,this.unsubscribers=[],this.assignments=null,this.playerOrder=[],this.playerCount=0,this.timeLimitSeconds=0,this._phaseTimer=null}async startGame(t,e,s=0){const a=Object.keys(t);this.playerCount=a.length,this.playerOrder=vt(a),this.timeLimitSeconds=s||0,this.assignments=ht.assignRoles(this.playerOrder,e);const n={};for(const[c,u]of Object.entries(this.assignments))n[`privateData/${this.roomCode}/${c}`]={role:u.role,team:u.team,visibleInfo:u.visibleInfo};const i={...n},o=N(this.timeLimitSeconds,h.ROLE_REVEAL),r={phase:h.ROLE_REVEAL,currentMission:0,missionResults:["pending","pending","pending","pending","pending"],currentLeaderIndex:0,playerOrder:this.playerOrder,totalRejects:0,teamProposal:null,voteResult:null,missionResult:null,winner:null,winReason:null,timeLimitSeconds:this.timeLimitSeconds,phaseDeadline:o?Date.now()+o*1e3:0};i[`rooms/${this.roomCode}/gameState`]=r,i[`rooms/${this.roomCode}/meta/status`]="playing",i[`rooms/${this.roomCode}/actions`]={votes:null,missionCards:null,assassination:null,readyPlayers:null},i[`rooms/${this.roomCode}/readyStatus`]=null,await f(d(),i),this.listenForReady(h.ROLE_REVEAL)}async resume(){const t=await E(d(m,`rooms/${this.roomCode}`));if(!t.exists())return;const s=t.val().gameState;if(!s)return;this.playerOrder=s.playerOrder,this.playerCount=this.playerOrder.length,this.timeLimitSeconds=s.timeLimitSeconds||0;const n=(await E(d(m,`privateData/${this.roomCode}`))).val()||{};this.assignments={};for(const i of this.playerOrder){const o=n[i];o&&(this.assignments[i]={role:o.role,team:o.team,visibleInfo:o.visibleInfo})}switch(s.phase){case h.ROLE_REVEAL:this.listenForReady(h.ROLE_REVEAL,s.phaseDeadline||0);break;case h.TEAM_PROPOSAL:this.listenForTeamProposal(s.phaseDeadline||0);break;case h.VOTING:this.listenForVotes(s.phaseDeadline||0);break;case h.MISSION:this.listenForMissionCards(s.teamProposal.members,s.phaseDeadline||0);break;case h.ASSASSINATION:this.listenForAssassination(s.phaseDeadline||0);break;case h.VOTE_RESULT:this.listenForReady(h.VOTE_RESULT,s.phaseDeadline||0);break;case h.MISSION_RESULT:this.listenForReady(h.MISSION_RESULT,s.phaseDeadline||0);break}}_clearPhaseTimer(){this._phaseTimer&&(clearTimeout(this._phaseTimer),this._phaseTimer=null)}_startPhaseTimer(t,e,s=0){this._clearPhaseTimer();const a=N(this.timeLimitSeconds,t),n=s?Math.max(0,s-Date.now()):a*1e3;!a&&!s||(this._phaseTimer=setTimeout(async()=>{try{await e()}catch(i){console.error("[GameEngine] 타이머 자동 처리 오류:",i)}},n))}async _setPhaseDeadline(t){const e=N(this.timeLimitSeconds,t),s=e?Date.now()+e*1e3:0;await f(d(m,`rooms/${this.roomCode}/gameState`),{phaseDeadline:s})}listenForReady(t,e=0){this.clearListeners();const s=M(d(m,`rooms/${this.roomCode}/actions/readyPlayers`),async a=>{const n=a.val()||{};this.playerOrder.every(o=>n[o])&&(this._clearPhaseTimer(),await this.onAllPlayersReady())});this.unsubscribers.push(s),t&&this._startPhaseTimer(t,async()=>{const n=(await E(d(m,`rooms/${this.roomCode}/actions/readyPlayers`))).val()||{},i={};for(const o of this.playerOrder)n[o]||(i[`rooms/${this.roomCode}/actions/readyPlayers/${o}`]=!0);Object.keys(i).length>0&&await f(d(),i)},e)}listenForVotes(t=0){this.clearListeners();const e=Z.onVotesChange(this.roomCode,this.playerOrder,async(s,a)=>{a&&(this._clearPhaseTimer(),await this.onAllVotesReceived(s))});this.unsubscribers.push(e),this._startPhaseTimer(h.VOTING,async()=>{const a=(await E(d(m,`rooms/${this.roomCode}/actions/votes`))).val()||{},n={};for(const i of this.playerOrder)a[i]||(n[`rooms/${this.roomCode}/actions/votes/${i}`]={vote:"reject",submittedAt:Date.now()});Object.keys(n).length>0&&await f(d(),n)},t)}listenForMissionCards(t,e=0){this.clearListeners();const s=it.onMissionCardsChange(this.roomCode,t,async(a,n)=>{n&&(this._clearPhaseTimer(),await this.onAllMissionCardsReceived(a))});this.unsubscribers.push(s),this._startPhaseTimer(h.MISSION,async()=>{const n=(await E(d(m,`rooms/${this.roomCode}/actions/missionCards`))).val()||{},i={};for(const o of t)n[o]||(i[`rooms/${this.roomCode}/actions/missionCards/${o}`]={card:"success",submittedAt:Date.now()});Object.keys(i).length>0&&await f(d(),i)},e)}listenForAssassination(t=0){this.clearListeners();const e=ot.onAssassinationChange(this.roomCode,async s=>{s&&s.targetId&&(this._clearPhaseTimer(),await this.onAssassinationTarget(s.targetId))});this.unsubscribers.push(e),this._startPhaseTimer(h.ASSASSINATION,async()=>{const s=Object.entries(this.assignments).find(([,r])=>r.role===g.ASSASSIN)?.[0];if(!s)return;const i=(await E(d(m,`privateData/${this.roomCode}/${s}`))).val()?.assassinTargets||[];if(i.length===0)return;const o=i[Math.floor(Math.random()*i.length)];await _(d(m,`rooms/${this.roomCode}/actions/assassination/targetId`),o)},t)}clearListeners(){this.unsubscribers.forEach(t=>{typeof t=="function"&&t()}),this.unsubscribers=[]}async onAllPlayersReady(){const e=(await E(d(m,`rooms/${this.roomCode}/gameState`))).val();if(e)switch(await S(d(m,`rooms/${this.roomCode}/actions/readyPlayers`)),e.phase){case h.ROLE_REVEAL:await this.transitionToTeamProposal();break;case h.VOTE_RESULT:if(e.voteResult?.approved)await this.transitionToMission();else{const s=(e.currentLeaderIndex+1)%this.playerOrder.length;await this.transitionToTeamProposal(s)}break;case h.MISSION_RESULT:await this.checkMissionEnd();break}}async transitionToTeamProposal(t=null){await Z.clearVotes(this.roomCode),await S(d(m,`rooms/${this.roomCode}/actions/teamProposal`));const e=N(this.timeLimitSeconds,h.TEAM_PROPOSAL),s={phase:h.TEAM_PROPOSAL,teamProposal:null,voteResult:null,missionResult:null,phaseDeadline:e?Date.now()+e*1e3:0};t!==null&&(s.currentLeaderIndex=t),await f(d(m,`rooms/${this.roomCode}/gameState`),s),this.listenForTeamProposal()}listenForTeamProposal(t=0){this.clearListeners();const e=M(d(m,`rooms/${this.roomCode}/actions/teamProposal`),async s=>{const a=s.val();if(a&&a.members&&a.members.length>0){const i=(await E(d(m,`rooms/${this.roomCode}/gameState`))).val();if(!i)return;const o=i.playerOrder[i.currentLeaderIndex],r=D[i.playerOrder.length][i.currentMission],c=Array.isArray(a.members)?a.members:[],u=new Set(c),p=c.every(v=>i.playerOrder.includes(v));if(a.leaderId!==o||c.length!==r||u.size!==c.length||!p)return;this._clearPhaseTimer(),await f(d(m,`rooms/${this.roomCode}/gameState`),{teamProposal:a}),await this.transitionToVoting()}});this.unsubscribers.push(e),this._startPhaseTimer(h.TEAM_PROPOSAL,async()=>{const a=(await E(d(m,`rooms/${this.roomCode}/gameState`))).val();if(!a)return;const n=a.playerOrder[a.currentLeaderIndex],i=D[a.playerOrder.length][a.currentMission],r=vt(a.playerOrder).slice(0,i);await _(d(m,`rooms/${this.roomCode}/actions/teamProposal`),{leaderId:n,members:r})},t)}async transitionToVoting(){await Z.clearVotes(this.roomCode);const t=N(this.timeLimitSeconds,h.VOTING);await f(d(m,`rooms/${this.roomCode}/gameState`),{phase:h.VOTING,phaseDeadline:t?Date.now()+t*1e3:0}),this.listenForVotes()}async onAllVotesReceived(t){const e=Z.tallyVotes(t),a=(await E(d(m,`rooms/${this.roomCode}/gameState`))).val(),i=(await E(d(m,`rooms/${this.roomCode}/meta`))).val()||{};if(i.voteMode==="public"){const c={};for(const[u,p]of Object.entries(t))c[u]=p.vote;e.playerVotes=c}const o=i.voteHistoryEnabled!==!1;let r=a.voteHistory||[];if(o){const c={};for(const[u,p]of Object.entries(t))c[u]=p.vote;r=[...r,{mission:a.currentMission,leaderId:a.teamProposal?.leaderId||null,teamMembers:a.teamProposal?.members||[],approved:e.approved,approveCount:e.approveCount,rejectCount:e.rejectCount,playerVotes:c}]}if(e.approved){const c={phase:h.VOTE_RESULT,voteResult:e};o&&(c.voteHistory=r),await f(d(m,`rooms/${this.roomCode}/gameState`),c)}else{const c=(a.totalRejects||0)+1;if(c>=dt){o&&await f(d(m,`rooms/${this.roomCode}/gameState`),{voteHistory:r}),await this.endGame("evil","팀 구성 누적 5회 실패");return}const u={phase:h.VOTE_RESULT,voteResult:e,totalRejects:c};o&&(u.voteHistory=r),await f(d(m,`rooms/${this.roomCode}/gameState`),u)}await this._setPhaseDeadline(h.VOTE_RESULT),this.listenForReady(h.VOTE_RESULT)}async transitionToMission(){const e=(await E(d(m,`rooms/${this.roomCode}/gameState`))).val();await it.clearMissionCards(this.roomCode);const s=N(this.timeLimitSeconds,h.MISSION);await f(d(m,`rooms/${this.roomCode}/gameState`),{phase:h.MISSION,phaseDeadline:s?Date.now()+s*1e3:0}),this.listenForMissionCards(e.teamProposal.members)}async onAllMissionCardsReceived(t){const s=(await E(d(m,`rooms/${this.roomCode}/gameState`))).val(),a=it.judgeMission(t,this.playerCount,s.currentMission),n=[...s.missionResults||["pending","pending","pending","pending","pending"]];n[s.currentMission]=a.success?"success":"fail";const i=(s.currentLeaderIndex+1)%this.playerOrder.length,o=N(this.timeLimitSeconds,h.MISSION_RESULT);await f(d(m,`rooms/${this.roomCode}/gameState`),{phase:h.MISSION_RESULT,missionResults:n,missionResult:a,currentLeaderIndex:i,currentMission:s.currentMission+1,phaseDeadline:o?Date.now()+o*1e3:0}),this.listenForReady(h.MISSION_RESULT)}async checkMissionEnd(){const s=(await E(d(m,`rooms/${this.roomCode}/gameState`))).val().missionResults||[],a=s.filter(i=>i==="success").length,n=s.filter(i=>i==="fail").length;if(a>=pt)if(Object.values(this.assignments).some(o=>o.role===g.MERLIN)){await ot.clearAssassination(this.roomCode);const o=Object.entries(this.assignments).filter(([,u])=>u.team==="good").map(([u])=>u),r=Object.entries(this.assignments).find(([,u])=>u.role===g.ASSASSIN)?.[0];r&&await f(d(m,`privateData/${this.roomCode}/${r}`),{assassinTargets:o});const c=N(this.timeLimitSeconds,h.ASSASSINATION);await f(d(m,`rooms/${this.roomCode}/gameState`),{phase:h.ASSASSINATION,phaseDeadline:c?Date.now()+c*1e3:0}),this.listenForAssassination()}else await this.endGame("good","미션 3회 성공");else n>=pt?await this.endGame("evil","미션 3회 실패"):await this.transitionToTeamProposal()}async onAssassinationTarget(t){const e=ot.judgeAssassination(t,this.assignments);e.validTarget&&(e.merlinKilled?await this.endGame("evil","멀린 암살 성공"):await this.endGame("good","멀린 암살 실패 — 선의 세력 최종 승리"))}async endGame(t,e){this.clearListeners();const s={};for(const[a,n]of Object.entries(this.assignments))s[a]={role:n.role,team:n.team};await f(d(m,`rooms/${this.roomCode}/gameState`),{phase:h.RESULT,winner:t,winReason:e,roleReveal:s}),await f(d(m,`rooms/${this.roomCode}/meta`),{status:"finished"}),this.scheduleCleanup()}scheduleCleanup(){setTimeout(async()=>{try{const t=await E(d(m,`rooms/${this.roomCode}/meta/status`));t.exists()&&t.val()==="finished"&&(await S(d(m,`rooms/${this.roomCode}`)),await S(d(m,`privateData/${this.roomCode}`)))}catch{}},1800*1e3)}destroy(){this._clearPhaseTimer(),this.clearListeners()}}const Ft=["기사 아서","란슬롯","가웨인","트리스탄","갈라해드","케이","보스","엘레인","모건"];class V{static _botIds=[];static _unsubscriber=null;static _lastStateKey=null;static _memory={missionHistory:[],suspicion:{},voteHistory:[]};static getBotIdsFromPlayers(t){return Object.keys(t||{}).filter(e=>e.startsWith("bot_"))}static _pickBotNames(t,e){const s=new Set(Object.values(t||{}).map(i=>i?.name).filter(Boolean)),a=[];for(const i of Ft){if(a.length>=e)break;s.has(i)||(a.push(i),s.add(i))}let n=1;for(;a.length<e;){const i=`봇 ${n}`;s.has(i)||(a.push(i),s.add(i)),n+=1}return a}static async addBots(t,e=1){const s=await E(d(m,`rooms/${t}/players`)),a=s.exists()?s.val():{},n=this._pickBotNames(a,e),i=[];for(let o=0;o<e;o++){const r=`bot_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;i.push(r),await _(d(m,`rooms/${t}/players/${r}`),{name:n[o],online:!0,joinedAt:Date.now()+o,order:100+o})}return this._botIds=[...this._botIds,...i],i}static async removeBots(t,e=this._botIds){for(const s of e)await S(d(m,`rooms/${t}/players/${s}`));this._botIds=this._botIds.filter(s=>!e.includes(s))}static async removeAllBotsFromPlayers(t,e){const s=this.getBotIdsFromPlayers(e);s.length!==0&&await this.removeBots(t,s)}static startListening(t,e){this.stopListening(),this._botIds=e,this._lastStateKey=null,this._memory={missionHistory:[],suspicion:{},voteHistory:[]},this._unsubscriber=M(d(m,`rooms/${t}/gameState`),s=>{const a=s.val();if(!a||!a.phase)return;const n=`${a.phase}_m${a.currentMission}_l${a.currentLeaderIndex}`;n!==this._lastStateKey&&(this._lastStateKey=n,this._act(t,a).catch(i=>{console.error("[BotService] 봇 행동 오류:",i)}))})}static stopListening(){this._unsubscriber&&(this._unsubscriber(),this._unsubscriber=null),this._lastStateKey=null}static syncBotIds(t){this._botIds=[...t]}static async _act(t,e){const s={};for(const a of this._botIds){const n=await E(d(m,`privateData/${t}/${a}`));n.exists()&&(s[a]=n.val())}switch(e.phase){case"role_reveal":await this._submitReadyAll(t);break;case"team_proposal":await this._handleTeamProposal(t,e,s);break;case"voting":await this._handleVoting(t,e,s);break;case"vote_result":await this._recordVoteResult(t,e),await this._submitReadyAll(t);break;case"mission":await this._handleMission(t,e,s);break;case"mission_result":this._recordMissionResult(e),await this._submitReadyAll(t);break;case"assassination":await this._handleAssassination(t,e,s);break}}static async _handleTeamProposal(t,e,s){const a=e.playerOrder[e.currentLeaderIndex];if(!this._botIds.includes(a))return;await this._delay(1200,2500);const n=s[a],i=e.playerOrder.length,o=e.currentMission,r=D[i][o];let c;n?.team==="evil"?c=this._proposeAsEvil(a,n,e,r):c=this._proposeAsGood(a,e,r),await _(d(m,`rooms/${t}/actions/teamProposal`),{leaderId:a,members:c})}static _proposeAsGood(t,e,s){const a=[t],n=e.playerOrder.filter(i=>i!==t).map(i=>({id:i,suspicion:this._memory.suspicion[i]||0})).sort((i,o)=>i.suspicion-o.suspicion);for(const i of n){if(a.length>=s)break;a.push(i.id)}return a}static _proposeAsEvil(t,e,s,a){const n=[t],i=(e.visibleInfo||[]).filter(c=>c.label==="evil_ally").map(c=>c.id),o=this._shuffle(i);o.length>0&&n.length<a&&n.push(o[0]);const r=this._shuffle(s.playerOrder.filter(c=>!n.includes(c)));for(const c of r){if(n.length>=a)break;n.push(c)}return n}static async _handleVoting(t,e,s){await this._delay(800,2e3);const n=e.teamProposal?.members||[];for(const i of this._botIds){const o=s[i];let r;o?.team==="evil"?r=this._voteAsEvil(i,o,n,e):r=this._voteAsGood(i,n,e),await _(d(m,`rooms/${t}/actions/votes/${i}`),{vote:r,submittedAt:Date.now()}),await this._delay(200,600)}}static _voteAsGood(t,e,s){let a=.5;e.includes(t)&&(a+=.25);const n=e.filter(i=>(this._memory.suspicion[i]||0)>=2).length;return a-=n*.2,(s.totalRejects||0)>=3&&(a+=.35),Math.random()<Math.max(.1,Math.min(.95,a))?"approve":"reject"}static _voteAsEvil(t,e,s,a){const n=(e.visibleInfo||[]).filter(c=>c.label==="evil_ally").map(c=>c.id),i=[t,...n];let o=.4;const r=s.filter(c=>i.includes(c)).length;return r>0&&(o+=.35),r===0&&(o-=.25),(a.totalRejects||0)>=3&&(o+=.2),Math.random()<Math.max(.1,Math.min(.9,o))?"approve":"reject"}static async _handleMission(t,e,s){const a=e.teamProposal?.members||[],n=a.filter(i=>this._botIds.includes(i));if(n.length!==0){await this._delay(1e3,2500);for(const i of n){const o=s[i];let r;o?.team==="good"?r="success":r=this._missionCardAsEvil(i,o,e,a),await _(d(m,`rooms/${t}/actions/missionCards/${i}`),{card:r,submittedAt:Date.now()}),await this._delay(200,500)}}}static _missionCardAsEvil(t,e,s,a){const n=s.currentMission,i=s.missionResults||[],o=i.filter(c=>c==="success").length,r=i.filter(c=>c==="fail").length;return n===0?"success":o>=2?"fail":r>=2?Math.random()<.6?"success":"fail":Math.random()<.75?"fail":"success"}static async _handleAssassination(t,e,s){const a=this._botIds.find(o=>s[o]?.role==="assassin");if(!a)return;const n=s[a]?.assassinTargets||[];if(n.length===0)return;await this._delay(2e3,4e3);const i=this._deduceMerlin(a,s[a],n);await _(d(m,`rooms/${t}/actions/assassination/targetId`),i)}static _deduceMerlin(t,e,s){const a=(e.visibleInfo||[]).filter(r=>r.label==="evil_ally").map(r=>r.id),n=[t,...a],i={};for(const r of s){let c=0,u=0;for(const p of this._memory.voteHistory)p.proposal.some(b=>n.includes(b))&&p.votes[r]&&(c++,p.votes[r]==="reject"&&u++);i[r]=c>0?u/c:0}const o=s.map(r=>({id:r,ratio:i[r]})).sort((r,c)=>c.ratio-r.ratio);if(o.length>0&&o[0].ratio>0){const r=o[0].ratio,c=o.filter(u=>u.ratio===r);return c[Math.floor(Math.random()*c.length)].id}return s[Math.floor(Math.random()*s.length)]}static async _recordVoteResult(t,e){if(!e.voteResult)return;const a=e.teamProposal?.members||[],n=await E(d(m,`rooms/${t}/actions/votes`)),i={};if(n.exists()){const o=n.val();for(const[r,c]of Object.entries(o))i[r]=c.vote}this._memory.voteHistory.push({proposal:a,votes:i})}static _recordMissionResult(t){const e=t.missionResult,s=t.teamProposal?.members||[];if(e)if(this._memory.missionHistory.push({members:s,success:e.success,failCount:e.failCount||0}),e.success)for(const a of s)this._memory.suspicion[a]=(this._memory.suspicion[a]||0)-.5;else for(const a of s)this._memory.suspicion[a]=(this._memory.suspicion[a]||0)+2}static async _submitReadyAll(t){await this._delay(500,1200);for(const e of this._botIds)await _(d(m,`rooms/${t}/actions/readyPlayers/${e}`),!0),await this._delay(100,300)}static _delay(t,e){const s=t+Math.random()*(e-t);return new Promise(a=>setTimeout(a,s))}static _shuffle(t){const e=[...t];for(let s=e.length-1;s>0;s--){const a=Math.floor(Math.random()*(s+1));[e[s],e[a]]=[e[a],e[s]]}return e}}function $t(l){return Object.entries(l||{}).filter(([t,e])=>t.startsWith("bot_")||e?.online!==!1).sort((t,e)=>(t[1]?.order||0)-(e[1]?.order||0)).map(([t])=>t)}function Ut({players:l,readyPlayers:t,hostId:e,minPlayers:s,maxPlayers:a}){const n=$t(l),i=n.length,o=i>=s&&i<=a,r=n.filter(p=>p!==e),c=r.filter(p=>p.startsWith("bot_")||t?.[p]).length,u=r.every(p=>p.startsWith("bot_")||t?.[p]);return{activePlayerIds:n,count:i,hasEnoughPlayers:o,nonHostPlayers:r,readyCount:c,allReady:u,canStart:o&&u}}function bt({hasEnoughPlayers:l,count:t,minPlayers:e,allReady:s,readyCount:a,requiredReadyCount:n}){return l?s?"게임 시작":`준비 대기 중 (${a}/${n})`:`최소 ${e}명이 필요합니다 (현재 ${t}명)`}function gt(l,t){return`팀 제안 (${l}/${t})`}function rt(l=!1){return l?"다른 플레이어를 기다리는 중....":"확인"}function qt(){return"투표 완료"}function Kt(){return"다음"}function tt(){return"다른 플레이어를 기다리는 중...."}function zt(){return{success:"성공",fail:"실패"}}function lt(l){return l?tt():"다음"}function Wt(l){return"투표 완료. 결과 대기 중..."}class Jt{constructor(t){this.roomCode=t,this.container=document.getElementById("app"),this.unsubscribers=[],this.players={},this.meta=null,this.isHost=!1,this.botIds=[],this.readyPlayers={},this.isReady=!1,this.pendingKickPlayer=null,this.longPressTimer=null,this.hasExitedLobby=!1}render(){this.container.innerHTML=`
      <div class="view lobby-view fade-in">
        <div class="view-header">
          <h1 class="view-title">대기실</h1>
          <div class="room-code-display">
            <span class="room-code-label">방 코드</span>
            <span class="room-code" id="room-code">${this.roomCode}</span>
            <button class="btn-copy" id="btn-copy" title="복사">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="lobby-players card" id="player-list">
          <div class="flex-center"><div class="spinner"></div></div>
        </div>

        <div class="modal-overlay" id="kick-modal" style="display:none">
          <div class="modal">
            <h2 class="modal-title">강제 퇴장</h2>
            <p class="text-muted" id="kick-modal-message">이 참가자를 강제 퇴장시키시겠습니까?</p>
            <div class="modal-actions">
              <button class="btn btn-evil btn-full" id="btn-kick-confirm">강제 퇴장</button>
              <button class="btn btn-outline btn-full" id="btn-kick-cancel">취소</button>
            </div>
          </div>
        </div>

        <div class="lobby-config card" id="role-config" style="display:none">
          <h3 class="config-title">역할 구성</h3>
          <div id="role-toggles"></div>
        </div>

        <div class="lobby-time-config card" id="time-config" style="display:none">
          <h3 class="config-title">시간 제한</h3>
          <div class="time-preset-buttons" id="time-preset-buttons"></div>
        </div>

        <div class="lobby-option-config card" id="vote-mode-config" style="display:none">
          <label class="toggle-item">
            <span class="toggle-label">실명 투표</span>
            <input type="checkbox" class="toggle-input" id="vote-mode-toggle" />
            <span class="toggle-slider"></span>
          </label>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:4px">
            투표 결과에서 각 플레이어의 찬성/반대를 공개합니다
          </p>
        </div>

        <div class="lobby-option-config card" id="vote-history-config" style="display:none">
          <label class="toggle-item">
            <span class="toggle-label">투표 기록 열람</span>
            <input type="checkbox" class="toggle-input" id="vote-history-toggle" checked />
            <span class="toggle-slider"></span>
          </label>
          <p class="text-muted" style="font-size:var(--font-size-xs);margin-top:4px">
            게임 중 과거 라운드의 투표 내역을 확인할 수 있습니다
          </p>
        </div>

        <div class="lobby-actions" id="lobby-actions">
          <button class="btn btn-good btn-full" id="btn-ready">준비 완료</button>
          <button class="btn btn-primary btn-full" id="btn-start" style="display:none" disabled>
            게임 시작
          </button>
          <button class="btn btn-outline btn-full" id="btn-leave">나가기</button>
        </div>
      </div>
    `,this.bindEvents(),this.subscribe()}bindEvents(){document.getElementById("btn-copy").addEventListener("click",()=>{navigator.clipboard.writeText(this.roomCode).then(()=>{const t=document.getElementById("btn-copy");t.innerHTML='<span style="font-size:12px">OK</span>',setTimeout(()=>{t.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'},1500)})}),document.getElementById("vote-mode-toggle")?.addEventListener("change",async t=>{await A.updateVoteMode(this.roomCode,t.target.checked?"public":"anonymous")}),document.getElementById("vote-history-toggle")?.addEventListener("change",async t=>{await A.updateVoteHistoryEnabled(this.roomCode,t.target.checked)}),document.getElementById("btn-ready")?.addEventListener("click",async()=>{const t=document.getElementById("btn-ready");if(!t)return;const e=!this.isReady;t.disabled=!0;const s=`rooms/${this.roomCode}/readyStatus/${y.playerId}`;try{e?(await _(d(m,s),!0),this.isReady=!0,t.textContent="준비 취소",t.className="btn btn-outline btn-full"):(await S(d(m,s)),this.isReady=!1,t.textContent="준비 완료",t.className="btn btn-good btn-full")}catch(a){console.error("레디 상태 변경 실패:",a)}t.disabled=!1}),document.getElementById("btn-leave").addEventListener("click",async()=>{await S(d(m,`rooms/${this.roomCode}/readyStatus/${y.playerId}`)),await P.cancelPresence(this.roomCode,y.playerId),await A.leaveRoom(this.roomCode,y.playerId),y.roomCode=null,R.navigate("/")}),document.getElementById("btn-kick-cancel")?.addEventListener("click",()=>{this.hideKickModal()}),document.getElementById("btn-kick-confirm")?.addEventListener("click",async()=>{if(!this.pendingKickPlayer)return;const t=document.getElementById("btn-kick-confirm");t&&(t.disabled=!0);try{await A.kickPlayer(this.roomCode,y.playerId,this.pendingKickPlayer.id),this.hideKickModal()}catch(e){console.error("강제 퇴장 실패:",e),t&&(t.disabled=!1)}}),document.getElementById("kick-modal")?.addEventListener("click",t=>{t.target.classList.contains("modal-overlay")&&this.hideKickModal()})}subscribe(){P.setupPresence(this.roomCode,y.playerId);const t=async()=>{this.hasExitedLobby||(this.hasExitedLobby=!0,this.hideKickModal(),await P.cancelPresence(this.roomCode,y.playerId).catch(()=>{}),y.roomCode=null,R.navigate("/"))},e=A.onRoomChange(this.roomCode,n=>{if(!n){t();return}if(this.meta=n.meta,this.players=n.players||{},this.isHost=n.meta.hostId===y.playerId,!this.players[y.playerId]){t();return}if(this.botIds=V.getBotIdsFromPlayers(this.players),V.syncBotIds(this.botIds),n.meta.status==="playing"){R.navigate("/game/"+this.roomCode);return}this.updatePlayerList(),this.updateRoleConfig(),this.updateTimeLimitConfig(),this.updateVoteModeConfig(),this.updateVoteHistoryConfig(),this.updateStartButton()}),s=M(d(m,`rooms/${this.roomCode}/players/${y.playerId}`),n=>{n.exists()||t()}),a=M(d(m,`rooms/${this.roomCode}/readyStatus`),n=>{this.readyPlayers=n.val()||{},this.isReady=!!this.readyPlayers[y.playerId];const i=document.getElementById("btn-ready");i&&(this.isHost?i.style.display="none":(i.style.display="block",i.textContent=this.isReady?"준비 취소":"준비 완료",i.className=this.isReady?"btn btn-outline btn-full":"btn btn-good btn-full")),this.updatePlayerList(),this.updateStartButton()});this.unsubscribers.push(e,a,s)}updatePlayerList(){const t=document.getElementById("player-list"),e=Object.entries(this.players).sort((n,i)=>n[1].order-i[1].order),s=e.length,a=this.isHost&&s<z?`
      <div class="bot-add-zone">
        <span class="bot-add-title">봇 추가 영역</span>
        <button class="btn btn-outline btn-bot-add" id="btn-add-bot" type="button">봇 추가</button>
      </div>
    `:"";t.innerHTML=`
      <div class="player-count">
        <span>참가자</span>
        <span class="${s>=K?"text-good":"text-evil"}">${s}명</span>
        <span class="text-muted">/ ${K}~${z}명</span>
      </div>
      <ul class="player-list">
        ${e.map(([n,i])=>`
          <li class="player-item ${i.online?"":"player-offline"} ${this.canForceKick(n)?"player-kickable":""}" data-player-id="${n}">
            <div class="player-head">
              <span class="player-name ${n===this.meta.hostId?"player-name-host":""}">${this.escapeHtml(i.name)}</span>
              <div class="player-head-badges">
                ${n.startsWith("bot_")?'<span class="badge badge-bot">BOT</span>':""}
                ${n===this.meta.hostId||this.readyPlayers[n]?'<span class="badge badge-good">READY</span>':""}
              </div>
            </div>
            <div class="player-badges">
              ${i.online?"":'<span class="badge" style="opacity:0.5">오프라인</span>'}
              ${this.isHost&&n.startsWith("bot_")?`<button class="btn btn-outline btn-bot-remove" type="button" data-bot-id="${n}">삭제</button>`:""}
            </div>
          </li>
        `).join("")}
      </ul>
      ${a}
    `,t.querySelector("#btn-add-bot")?.addEventListener("click",async()=>{const n=document.getElementById("btn-add-bot");if(n){n.disabled=!0;try{if(Object.keys(this.players).length>=z)return;const o=await V.addBots(this.roomCode,1);this.botIds=[...this.botIds,...o],V.syncBotIds(this.botIds)}catch(i){console.error("봇 추가 실패:",i)}finally{n.disabled=!1}}}),t.querySelectorAll(".btn-bot-remove").forEach(n=>{n.disabled||n.addEventListener("click",async()=>{const i=n.dataset.botId;if(i){n.disabled=!0;try{await V.removeBots(this.roomCode,[i]),this.botIds=this.botIds.filter(o=>o!==i),V.syncBotIds(this.botIds)}catch(o){console.error("봇 제거 실패:",o),n.disabled=!1}}})}),this.bindKickTriggers(t)}updateRoleConfig(){const t=document.getElementById("role-config");t.style.display="block";const e=Object.keys(this.players).length,s=W(e,this.meta.roleConfig||{}),a=X[e]?.good||3,n=X[e]?.evil||2,i=W(e,s),o=1+(s.morgana?1:0)+(s.mordred?1:0)+(s.oberon?1:0),r=Ht(s),c=Nt(e),u=r>=c,p=1+(s.percival?1:0),v=Math.max(0,a-p),b=Math.max(0,n-o),x=document.getElementById("role-toggles"),$=[{key:"merlin",team:"good",label:"멀린",count:1,fixed:!0},{key:"percival",team:"good",label:"퍼시벌",count:s.percival?1:0,checked:!!s.percival},{key:"loyal_servant",team:"good",label:"충성 기사",count:v,fixed:!0},{key:"assassin",team:"evil",label:"암살자",count:1,fixed:!0},{key:"morgana",team:"evil",label:"모르가나",count:s.morgana?1:0,checked:!!s.morgana,disabled:!s.morgana&&u},{key:"mordred",team:"evil",label:"모드레드",count:s.mordred?1:0,checked:!!s.mordred,disabled:!s.mordred&&u},{key:"oberon",team:"evil",label:"오베론",count:s.oberon?1:0,checked:!!s.oberon,disabled:!s.oberon&&u},{key:"minion",team:"evil",label:"하수인",count:b,fixed:!0}],O=(L,I,C)=>{const k=$.filter(T=>T.team===L);return`
        <div class="role-team-section role-team-${L}">
          <div class="role-team-header">
            <span class="role-team-title">${I}</span>
            <span class="text-muted">${C}</span>
          </div>
          <div class="role-card-grid">
            ${k.map(T=>{const H=T.fixed?T.count>0:!!T.checked,U=!!T.disabled,wt=["role-config-card",`role-config-card-${L}`,H?"role-config-card-active":"role-config-card-inactive",U?"role-config-card-disabled":"",T.fixed?"role-config-card-fixed":"role-config-card-toggle"].filter(Boolean).join(" "),Ct=T.fixed?'<span class="role-config-fixed">고정</span>':`<span class="role-config-toggle-text">${H?"사용":"제외"}</span>`;return`
                <label class="${wt}">
                  <div class="role-config-main">
                    <span class="role-config-name">${T.label}</span>
                    <span class="role-config-count-badge">${T.count}명</span>
                  </div>
                  <div class="role-config-meta">
                    ${Ct}
                  </div>
                  ${T.fixed?"":`
                    <input type="checkbox" class="role-config-input" data-role="${T.key}"
                      ${T.checked?"checked":""} ${U||!this.isHost?"disabled":""} />
                  `}
                </label>
              `}).join("")}
          </div>
        </div>
      `};x.innerHTML=`
      ${O("good","선의 세력",`총 ${a}명`)}
      ${O("evil","악의 세력",`총 ${n}명`)}
      ${this.isHost?"":'<p class="text-muted" style="margin-top:12px;font-size:var(--font-size-xs)">역할 구성 변경은 방장만 할 수 있습니다</p>'}
    `,x.querySelectorAll(".role-config-input").forEach(L=>{L.addEventListener("change",async I=>{const C=I.target.dataset.role,k=W(e,{...i,[C]:I.target.checked});await A.updateRoleConfig(this.roomCode,k)})})}updateTimeLimitConfig(){const t=document.getElementById("time-config");if(!this.isHost){t.style.display="none";return}t.style.display="block";const e=document.getElementById("time-preset-buttons"),s=this.meta.timeLimitSeconds||0;e.innerHTML=Vt.map(a=>`
      <button class="btn ${a.value===s?"btn-primary":"btn-outline"} btn-time-preset"
              data-time="${a.value}">${a.label}</button>
    `).join(""),e.querySelectorAll(".btn-time-preset").forEach(a=>{a.addEventListener("click",async()=>{const n=parseInt(a.dataset.time);await A.updateTimeLimit(this.roomCode,n)})})}updateVoteModeConfig(){const t=document.getElementById("vote-mode-config");if(!t)return;t.style.display="block";const e=document.getElementById("vote-mode-toggle");e&&(e.checked=this.meta.voteMode==="public",e.disabled=!this.isHost);const s=t.querySelector(".toggle-item");s&&s.classList.toggle("toggle-disabled",!this.isHost)}updateVoteHistoryConfig(){const t=document.getElementById("vote-history-config");if(!t)return;if(!this.isHost){t.style.display="none";return}t.style.display="block";const e=document.getElementById("vote-history-toggle");if(e){const s=this.meta.voteHistoryEnabled!==!1;e.checked=s}}updateStartButton(){const t=document.getElementById("btn-start"),e=document.getElementById("btn-ready");if(!this.isHost){t.style.display="none",e&&(e.style.display="block");return}t.style.display="block",e&&(e.style.display="none");const s=Ut({players:this.players,readyPlayers:this.readyPlayers,hostId:this.meta.hostId,minPlayers:K,maxPlayers:z}),{count:a,hasEnoughPlayers:n,nonHostPlayers:i,readyCount:o,allReady:r,canStart:c}=s;t.disabled=!c,t.textContent=bt({hasEnoughPlayers:n,count:a,minPlayers:K,allReady:r,readyCount:o,requiredReadyCount:i.length}),t.onclick=async()=>{t.disabled=!0,t.textContent="시작 중...";try{const u=new St(this.roomCode),p=$t(this.players),v=Object.fromEntries(p.map(x=>[x,this.players[x]])),b=W(p.length,this.meta.roleConfig||{merlin:!0});await u.startGame(v,b,this.meta.timeLimitSeconds||0)}catch(u){console.error("게임 시작 실패:",u),t.disabled=!1,t.textContent=bt({hasEnoughPlayers:n,count:a,minPlayers:K,allReady:r,readyCount:o,requiredReadyCount:i.length})}}}escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}canForceKick(t){return this.isHost&&t!==y.playerId&&t!==this.meta?.hostId&&!t.startsWith("bot_")}bindKickTriggers(t){t.querySelectorAll(".player-item[data-player-id]").forEach(e=>{const s=e.dataset.playerId;!s||!this.canForceKick(s)||(e.addEventListener("dblclick",()=>{this.openKickModal(s)}),e.addEventListener("touchstart",()=>{this.clearLongPressTimer(),this.longPressTimer=setTimeout(()=>{this.openKickModal(s)},550)},{passive:!0}),e.addEventListener("touchend",()=>this.clearLongPressTimer(),{passive:!0}),e.addEventListener("touchcancel",()=>this.clearLongPressTimer(),{passive:!0}),e.addEventListener("touchmove",()=>this.clearLongPressTimer(),{passive:!0}))})}clearLongPressTimer(){this.longPressTimer&&(clearTimeout(this.longPressTimer),this.longPressTimer=null)}openKickModal(t){const e=this.players[t];if(!e||!this.canForceKick(t))return;this.pendingKickPlayer={id:t,name:e.name};const s=document.getElementById("kick-modal"),a=document.getElementById("kick-modal-message"),n=document.getElementById("btn-kick-confirm");a&&(a.textContent=`${e.name} 참가자를 강제 퇴장시키시겠습니까?`),n&&(n.disabled=!1),s&&(s.style.display="flex")}hideKickModal(){this.pendingKickPlayer=null,this.clearLongPressTimer();const t=document.getElementById("kick-modal"),e=document.getElementById("btn-kick-confirm");e&&(e.disabled=!1),t&&(t.style.display="none")}destroy(){this.clearLongPressTimer(),this.unsubscribers.forEach(t=>{typeof t=="function"&&t()})}}class J{static render(t,e,s){const a=D[t]||D[5],n=e||[];return`
      <div class="mission-track">
        ${a.map((i,o)=>{const r=n[o],c=o===s&&r!=="success"&&r!=="fail",u=ut(t,o)===2;let p="",v="";return r==="success"?(p="mission-success",v='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'):r==="fail"?(p="mission-fail",v='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'):v=`<span class="mission-num">${i}</span>`,`
            <div class="mission-slot ${p} ${c?"mission-current":""}">
              ${v}
              ${u?'<span class="mission-two-fails">2F</span>':""}
            </div>
          `}).join("")}
      </div>
    `}}class w{static render(t,e,s,a={}){const{selectedIds:n=[],selectableCount:i=0,isSelectable:o=!1,showVotes:r=!1,votes:c={},roleReveal:u=null,teamMembers:p=[]}=a,v=[];for(let b=0;b<e.length;b++)v.push(e[(s+b)%e.length]);return`
      <ul class="game-player-list">
        ${v.map((b,x)=>{const $=t[b];if(!$)return"";const O=x===0,L=n.includes(b),I=p.includes(b),C=c[b],k=u?.[b];let T="";if(r&&C){const U=C==="approve";T=`<span class="vote-badge ${U?"vote-approve":"vote-reject"}">${U?"찬성":"반대"}</span>`}let H="";return k&&(k.team,H=`<span class="badge ${k.team==="good"?"badge-good":"badge-evil"}">${w.getRoleName(k.role)}</span>`),`
            <li class="game-player-item ${L?"player-selected":""} ${I?"player-team":""} ${$.online?"":"player-offline"}"
                ${o?`data-player-id="${b}"`:""}>
              <div class="game-player-info">
                <div class="game-player-head">
                  ${O?'<span class="leader-icon" title="리더">&#9813;</span>':'<span class="leader-icon-placeholder"></span>'}
                  <span class="game-player-name">${w.escapeHtml($.name)}</span>
                  <div class="game-player-head-badges">
                    ${I?'<span class="badge badge-leader">팀원</span>':""}
                  </div>
                </div>
              </div>
              <div class="game-player-badges">
                ${T}
                ${H}
              </div>
            </li>
          `}).join("")}
      </ul>
    `}static getRoleName(t){return{merlin:"멀린",percival:"퍼시벌",loyal_servant:"충성 기사",assassin:"암살자",morgana:"모르가나",mordred:"모드레드",oberon:"오베론",minion:"하수인"}[t]||t}static escapeHtml(t){const e=document.createElement("div");return e.textContent=t,e.innerHTML}}class Yt{static render(t,e){if(!t)return"";const{approved:s,approveCount:a,rejectCount:n,details:i}=t;return`
      <div class="vote-result-panel ${s?"vote-approved":"vote-rejected"}">
        <div class="vote-result-title">
          ${s?"팀 구성 승인":"팀 구성 거부"}
        </div>
        <div class="vote-result-count">
          <span class="text-good">찬성 ${a}</span>
          <span class="text-muted">/</span>
          <span class="text-evil">반대 ${n}</span>
        </div>
      </div>
    `}}class ft{static async sendMessage(t,e,s,a){const n=a.trim();!n||n.length>200||await Pt(d(m,`rooms/${t}/chat`),{playerId:e,playerName:s,text:n,timestamp:Date.now()})}static onChatChange(t,e){return M(d(m,`rooms/${t}/chat`),s=>{const a=s.val();if(!a){e([]);return}const n=Object.values(a).sort((i,o)=>i.timestamp-o.timestamp);e(n)})}}class B{static _ctx=null;static _muted=!1;static _bgmNode=null;static _bgmGain=null;static get ctx(){return this._ctx||(this._ctx=new(window.AudioContext||window.webkitAudioContext)),this._ctx}static get muted(){return this._muted}static toggleMute(){return this._muted=!this._muted,this._bgmGain&&(this._bgmGain.gain.value=this._muted?0:.08),localStorage.setItem("avalon_muted",this._muted?"1":"0"),this._muted}static init(){this._muted=localStorage.getItem("avalon_muted")==="1"}static playVoteSound(){if(this._muted)return;this._resumeCtx();const t=this.ctx,e=t.createOscillator(),s=t.createGain();e.connect(s),s.connect(t.destination),e.type="sine",e.frequency.setValueAtTime(600,t.currentTime),e.frequency.linearRampToValueAtTime(800,t.currentTime+.1),s.gain.setValueAtTime(.15,t.currentTime),s.gain.exponentialRampToValueAtTime(.001,t.currentTime+.3),e.start(t.currentTime),e.stop(t.currentTime+.3)}static playSuccessSound(){if(this._muted)return;this._resumeCtx();const t=this.ctx;[523,659,784].forEach((e,s)=>{const a=t.createOscillator(),n=t.createGain();a.connect(n),n.connect(t.destination),a.type="sine",a.frequency.value=e;const i=t.currentTime+s*.15;n.gain.setValueAtTime(.12,i),n.gain.exponentialRampToValueAtTime(.001,i+.4),a.start(i),a.stop(i+.4)})}static playFailSound(){if(this._muted)return;this._resumeCtx();const t=this.ctx;[300,250].forEach((e,s)=>{const a=t.createOscillator(),n=t.createGain();a.connect(n),n.connect(t.destination),a.type="sawtooth",a.frequency.value=e;const i=t.currentTime+s*.2;n.gain.setValueAtTime(.1,i),n.gain.exponentialRampToValueAtTime(.001,i+.4),a.start(i),a.stop(i+.4)})}static playPhaseTransition(){if(this._muted)return;this._resumeCtx();const t=this.ctx,e=t.createOscillator(),s=t.createGain();e.connect(s),s.connect(t.destination),e.type="triangle",e.frequency.setValueAtTime(440,t.currentTime),e.frequency.linearRampToValueAtTime(660,t.currentTime+.15),s.gain.setValueAtTime(.1,t.currentTime),s.gain.exponentialRampToValueAtTime(.001,t.currentTime+.3),e.start(t.currentTime),e.stop(t.currentTime+.3)}static startBGM(){if(this._bgmNode)return;this._resumeCtx();const t=this.ctx,e=[],s=t.createGain();s.gain.value=this._muted?0:.08,s.connect(t.destination),this._bgmGain=s;const a=t.createOscillator();a.type="sine",a.frequency.value=55,a.connect(s),a.start(),e.push(a);const n=t.createOscillator();n.type="sine",n.frequency.value=82.4;const i=t.createGain();i.gain.value=.5,n.connect(i),i.connect(s),n.start(),e.push(n);const o=t.createOscillator();o.type="sawtooth",o.frequency.value=110;const r=t.createBiquadFilter();r.type="lowpass",r.frequency.value=400,r.Q.value=2;const c=t.createGain();c.gain.value=.15,o.connect(r),r.connect(c),c.connect(s),o.start(),e.push(o);const u=t.createOscillator();u.type="sine",u.frequency.value=.05;const p=t.createGain();p.gain.value=200,u.connect(p),p.connect(r.frequency),u.start(),e.push(u);const v=t.createOscillator();v.type="sine",v.frequency.value=880;const b=t.createGain();b.gain.value=.02,v.connect(b),b.connect(s),v.start(),e.push(v);const x=t.createOscillator();x.type="sine",x.frequency.value=.08;const $=t.createGain();$.gain.value=.015,x.connect($),$.connect(b.gain),x.start(),e.push(x);const O=t.createOscillator();O.type="sine",O.frequency.value=27.5;const L=t.createGain();L.gain.value=.3,O.connect(L),L.connect(s),O.start(),e.push(O);const I=t.createOscillator();I.type="sine",I.frequency.value=.07;const C=t.createGain();C.gain.value=.015,I.connect(C),C.connect(s.gain),I.start(),e.push(I),this._bgmNode=e}static stopBGM(){if(!this._bgmNode)return;const t=this.ctx.currentTime;this._bgmGain&&this._bgmGain.gain.linearRampToValueAtTime(0,t+1);const e=this._bgmNode;setTimeout(()=>{for(const s of e)try{s.stop()}catch{}},1200),this._bgmNode=null,this._bgmGain=null}static _resumeCtx(){this.ctx.state==="suspended"&&this.ctx.resume()}}function It(l,t=[],e){return(Array.isArray(t)&&t.length>0?t:Object.entries(l||{}).sort((a,n)=>(a[1]?.order||0)-(n[1]?.order||0)).map(([a])=>a)).find(a=>a!==e&&l?.[a]?.online!==!1)||null}function Xt(l,t){const e=Array.isArray(l)?l:[],s=t||{},a=e.filter(n=>s[n]).length;return{total:e.length,readyCount:a,allReady:e.length>0&&a===e.length}}function Q(l,t,e,s=!1){const a=Array.isArray(l)?l:[],n={...t||{}};return s&&e&&a.includes(e)&&(n[e]=!0),Xt(a,n)}class Zt{constructor(t){this.roomCode=t,this.container=document.getElementById("app"),this.unsubscribers=[],this.phaseUnsubscribers=[],this.gameState=null,this.players={},this.meta=null,this.privateData=null,this.engine=null,this.selectedTeam=[],this.lastPhase=null,this.hasVoted=!1,this.submittedVote=null,this.hasSubmittedCard=!1,this.voteCount=0,this.missionCardCount=0,this.readyPhaseCount=0,this.hasConfirmedNext=!1,this.chatMessages=[],this._timerInterval=null,this._hostMigrationTimer=null}render(){this.container.innerHTML=`
      <div class="view game-view fade-in">
        <div class="game-content" id="game-content">
          <div class="flex-center"><div class="spinner"></div></div>
        </div>
        <div class="role-peek-overlay" id="role-peek-overlay">
          <div class="role-peek-card" id="role-peek-card"></div>
        </div>
        <button class="role-peek-btn" id="role-peek-btn" title="역할 확인 (길게 누르기)">
          <svg viewBox="0 0 40 56" width="28" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="38" height="54" rx="4" stroke="currentColor" stroke-width="2" fill="var(--color-bg-card)"/>
            <rect x="5" y="5" width="30" height="46" rx="2" stroke="currentColor" stroke-width="1" stroke-opacity="0.4" fill="none"/>
            <path d="M20 14 L14 20 L20 26 L26 20 Z" fill="currentColor" fill-opacity="0.6"/>
            <circle cx="20" cy="35" r="6" stroke="currentColor" stroke-width="1.5" fill="none" stroke-opacity="0.5"/>
            <circle cx="20" cy="35" r="2" fill="currentColor" fill-opacity="0.5"/>
          </svg>
        </button>
        <button class="audio-toggle-btn" id="audio-toggle-btn" title="사운드 ON/OFF">${B.muted?"&#128263;":"&#128266;"}</button>
        <button class="vote-history-btn" id="vote-history-btn" title="투표 기록">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
          </svg>
        </button>
        <div class="vote-history-overlay" id="vote-history-overlay">
          <div class="vote-history-panel" id="vote-history-panel"></div>
        </div>
        <div class="floating-chat" id="floating-chat">
          <div class="floating-chat-bubbles" id="floating-chat-bubbles"></div>
          <form class="floating-chat-form" id="floating-chat-form">
            <input class="floating-chat-input" id="floating-chat-input" type="text" placeholder="메시지..." maxlength="200" autocomplete="off" />
            <button class="floating-chat-send" type="submit">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
            </button>
          </form>
        </div>
      </div>
    `,this.subscribe(),this.bindRolePeekEvents(),this.bindChatEvents(),this.bindAudioEvents(),this.bindVoteHistoryEvents(),B.init(),B.startBGM()}bindRolePeekEvents(){const t=document.getElementById("role-peek-btn"),e=document.getElementById("role-peek-overlay"),s=document.getElementById("role-peek-card");if(!t||!e)return;let a=null,n=!1;const i=()=>{if(!this.privateData)return;const r=this.privateData.role,c=this.privateData.team,u=st[r];if(!u)return;const p=c==="good"?"선의 세력":"악의 세력",v=this.privateData.visibleInfo||[];let b="";v.length>0&&(b=`<ul class="visible-list mt-sm">${v.map($=>{const O=this.players[$.id],L=O?w.escapeHtml(O.name):"???";let I="";return $.label==="evil"?I="악의 세력":$.label==="evil_ally"?I="악의 동료":$.label==="merlin_or_morgana"&&(I="멀린 또는 모르가나"),`<li class="visible-item"><span>${L}</span><span class="badge ${$.label.includes("evil")?"badge-evil":"badge-good"}">${I}</span></li>`}).join("")}</ul>`),s.innerHTML=`
        <div class="role-card ${c==="good"?"role-card-good":"role-card-evil"}" style="max-width:100%">
          <div class="role-team-badge">
            <span class="badge ${c==="good"?"badge-good":"badge-evil"}">${p}</span>
          </div>
          <h3 class="role-name ${c==="good"?"text-good":"text-evil"}">${u.name}</h3>
          <p class="role-description">${u.description}</p>
          ${b}
        </div>
      `,e.classList.add("role-peek-visible"),n=!0},o=()=>{a&&(clearTimeout(a),a=null),n&&(e.classList.remove("role-peek-visible"),n=!1)};t.addEventListener("mousedown",r=>{r.preventDefault(),a=setTimeout(i,300)}),t.addEventListener("mouseup",o),t.addEventListener("mouseleave",o),t.addEventListener("touchstart",r=>{r.preventDefault(),a=setTimeout(i,300)}),t.addEventListener("touchend",o),t.addEventListener("touchcancel",o)}subscribe(){P.setupPresence(this.roomCode,y.playerId);const t=A.onRoomChange(this.roomCode,a=>{if(!a){R.navigate("/");return}if(this.meta=a.meta,this.players=a.players||{},this.gameState=a.gameState,this.handleHostMigration(a),a.meta.hostId===y.playerId&&!this.engine){this.engine=new St(this.roomCode),this.engine.resume();const o=V.getBotIdsFromPlayers(a.players||{});o.length>0&&V.startListening(this.roomCode,o)}const n=a.gameState?.phase;n!==this.lastPhase&&(this.lastPhase=n,this.hasVoted=!1,this.submittedVote=null,this.hasSubmittedCard=!1,this.hasConfirmedNext=!1,this.selectedTeam=[],this.voteCount=0,this.missionCardCount=0,this.clearPhaseListeners(),this.setupPhaseListeners(n),n===h.VOTE_RESULT?B.playVoteSound():n===h.MISSION_RESULT?a.gameState?.missionResult?.success?B.playSuccessSound():B.playFailSound():n&&B.playPhaseTransition()),this.updateUI();const i=document.getElementById("vote-history-btn");i&&(i.style.display=a.meta?.voteHistoryEnabled!==!1?"flex":"none")}),e=P.onPrivateDataChange(this.roomCode,y.playerId,a=>{this.privateData=a,this.updateUI()}),s=ft.onChatChange(this.roomCode,a=>{const n=a.slice(this.chatMessages.length);this.chatMessages=a;for(const i of n)this.addFloatingBubble(i)});this.unsubscribers.push(t,e,s)}handleHostMigration(t){const e=t.meta?.hostId;if(!e||!t.gameState){this.clearHostMigrationTimer();return}if(t.players?.[e]?.online!==!1){this.clearHostMigrationTimer();return}if(It(t.players||{},t.gameState.playerOrder||[],e)!==y.playerId){this.clearHostMigrationTimer();return}this._hostMigrationTimer||(this._hostMigrationTimer=setTimeout(async()=>{try{const n=await A.getRoomData(this.roomCode),i=n?.meta?.hostId,o=n?.players?.[i]?.online!==!1,r=It(n?.players||{},n?.gameState?.playerOrder||[],i);if(!n?.gameState||o||r!==y.playerId)return;await f(d(m,`rooms/${this.roomCode}/meta`),{hostId:y.playerId})}catch(n){console.error("호스트 승계 실패:",n)}finally{this.clearHostMigrationTimer()}},3e3))}clearHostMigrationTimer(){this._hostMigrationTimer&&(clearTimeout(this._hostMigrationTimer),this._hostMigrationTimer=null)}clearPhaseListeners(){this.phaseUnsubscribers.forEach(t=>{typeof t=="function"&&t()}),this.phaseUnsubscribers=[]}setupPhaseListeners(t){if(t===h.VOTING){const e=M(d(m,`rooms/${this.roomCode}/actions/votes`),s=>{const a=s.val()||{};this.voteCount=Object.keys(a).length;const n=a[y.playerId]?.vote||null;n&&(this.hasVoted=!0,this.submittedVote=n);const i=this.gameState?.playerOrder?.length||0,o=document.getElementById("vote-progress");o&&(o.textContent=`${this.voteCount} / ${i}`);const r=document.getElementById("vote-progress-bar");r&&i>0&&(r.style.width=`${Math.round(this.voteCount/i*100)}%`);const c=document.getElementById("vote-buttons"),u=document.getElementById("vote-complete-btn"),p=document.getElementById("vote-status");if(c&&(c.style.display=this.hasVoted?"none":"grid"),u&&(u.style.display=this.hasVoted?"flex":"none"),p&&(p.style.display=this.hasVoted?"block":"none",this.hasVoted)){const v=this.submittedVote==="approve"?"찬성":"반대";p.innerHTML=`투표가 완료되었습니다!<br>당신의 선택은 <strong>${v}</strong>입니다.`}});this.phaseUnsubscribers.push(e)}else if(t===h.ROLE_REVEAL||t===h.VOTE_RESULT||t===h.MISSION_RESULT){const e=M(d(m,`rooms/${this.roomCode}/actions/readyPlayers`),s=>{const a=s.val()||{},n=Q(this.gameState?.playerOrder||[],a,y.playerId,this.hasConfirmedNext);this.readyPhaseCount=n.readyCount,this.hasConfirmedNext=!!a[y.playerId]||this.hasConfirmedNext;const i=document.getElementById("btn-ready");i&&(i.disabled=this.hasConfirmedNext,this.hasConfirmedNext&&(this.gameState?.phase===h.ROLE_REVEAL?i.textContent=rt(!0):this.gameState?.phase===h.VOTE_RESULT?i.textContent=tt():this.gameState?.phase===h.MISSION_RESULT&&(i.textContent=lt(!0))));const o=document.getElementById("ready-progress");o&&(o.textContent=`대기 중 (${n.readyCount}/${n.total})`)});this.phaseUnsubscribers.push(e)}else if(t===h.MISSION){const e=M(d(m,`rooms/${this.roomCode}/actions/missionCards`),s=>{const a=s.val()||{};this.missionCardCount=Object.keys(a).length;const n=this.gameState?.teamProposal?.members?.length||0,i=document.getElementById("mission-progress");i&&(i.textContent=`${this.missionCardCount} / ${n}`);const o=document.getElementById("mission-progress-bar");o&&n>0&&(o.style.width=`${Math.round(this.missionCardCount/n*100)}%`)});this.phaseUnsubscribers.push(e)}}updateUI(){if(!this.gameState||!this.privateData)return;const t=document.getElementById("game-content");if(t)switch(this._stopTimerDisplay(),this.gameState.phase){case h.ROLE_REVEAL:t.innerHTML=this.renderRoleReveal(),this.bindRoleRevealEvents(),this._startTimerDisplay();break;case h.TEAM_PROPOSAL:t.innerHTML=this.renderTeamProposal(),this.bindTeamProposalEvents(),this._startTimerDisplay();break;case h.VOTING:t.innerHTML=this.renderVoting(),this.bindVotingEvents(),this._startTimerDisplay();break;case h.VOTE_RESULT:t.innerHTML=this.renderVoteResult(),this.bindVoteResultEvents(),this._startTimerDisplay();break;case h.MISSION:t.innerHTML=this.renderMission(),this.bindMissionEvents(),this._startTimerDisplay();break;case h.MISSION_RESULT:t.innerHTML=this.renderMissionResult(),this.bindMissionResultEvents(),this._startTimerDisplay();break;case h.ASSASSINATION:t.innerHTML=this.renderAssassination(),this.bindAssassinationEvents(),this._startTimerDisplay();break;case h.RESULT:R.navigate("/result/"+this.roomCode);break}}renderRoleReveal(){const t=this.privateData.role,e=this.privateData.team,s=st[t],a=this.privateData.visibleInfo||[],n=e==="good"?"text-good":"text-evil",i=e==="good"?"선의 세력":"악의 세력";let o="";a.length>0&&(o=`
        <div class="role-visible-info card mt-lg">
          <h3 class="text-center mb-sm">당신이 알고 있는 정보</h3>
          <ul class="visible-list">${a.map(u=>{const p=this.players[u.id],v=p?w.escapeHtml(p.name):"???";let b="";return u.label==="evil"?b="악의 세력":u.label==="evil_ally"?b="악의 동료":u.label==="merlin_or_morgana"&&(b="멀린 또는 모르가나"),`<li class="visible-item"><span>${v}</span><span class="badge ${u.label.includes("evil")?"badge-evil":"badge-good"}">${b}</span></li>`}).join("")}</ul>
        </div>
      `);const r=Q(this.gameState?.playerOrder||[],this.gameState?.readyPlayers||{},y.playerId,this.hasConfirmedNext);return`
      <div class="role-reveal fade-in">
        <h2 class="text-center mb-lg">당신의 역할 ${this._renderTimerHtml()}</h2>
        <div class="role-card ${e==="good"?"role-card-good":"role-card-evil"}">
          <div class="role-team-badge">
            <span class="badge ${e==="good"?"badge-good":"badge-evil"}">${i}</span>
          </div>
          <h3 class="role-name ${n}">${s.name}</h3>
          <p class="role-description">${s.description}</p>
        </div>
        ${o}
        <p class="text-center text-muted mt-xl" id="ready-progress">대기 중 (${r.readyCount}/${r.total})</p>
        <button class="btn btn-primary btn-full mt-sm" id="btn-ready">${rt(this.hasConfirmedNext)}</button>
      </div>
    `}bindRoleRevealEvents(){const t=document.getElementById("btn-ready");t?.addEventListener("click",async()=>{t.disabled=!0,t.textContent=rt(!0),this.hasConfirmedNext=!0;const e=document.getElementById("ready-progress"),s=Q(this.gameState?.playerOrder||[],this.gameState?.readyPlayers||{},y.playerId,!0);e&&(e.textContent=`대기 중 (${s.readyCount}/${s.total})`),await P.submitReady(this.roomCode,y.playerId)})}renderTeamProposal(){const t=this.gameState,e=t.playerOrder,s=t.currentLeaderIndex,a=e[s],n=a===y.playerId,i=this.players[a]?.name||"???",o=t.currentMission,r=e.length,c=D[r][o],u=t.totalRejects||0,p=J.render(r,t.missionResults,o),v=w.render(this.players,e,s,{selectedIds:this.selectedTeam,isSelectable:n,teamMembers:[]}),b=`
      <div class="reject-track">
        ${Array.from({length:dt},(x,$)=>`
          <div class="reject-dot ${$<u?"reject-active":""}"></div>
        `).join("")}
        <span class="reject-label text-muted">누적 거부 ${u}/${dt}</span>
      </div>
    `;return`
      <div class="team-proposal fade-in">
        ${p}
        ${b}
        <div class="phase-info">
          <h3>미션 ${o+1} — 팀 제안 ${this._renderTimerHtml()}</h3>
          <p class="text-muted">리더: <strong class="text-gold">${w.escapeHtml(i)}</strong></p>
          <p class="text-muted">팀원 ${c}명을 선택하세요</p>
        </div>
        ${v}
        ${n?`
          <button class="btn btn-primary btn-full mt-lg" id="btn-propose" disabled>
            ${gt(this.selectedTeam.length,c)}
          </button>
        `:`
          <p class="text-center text-muted mt-lg">리더가 팀을 제안하는 중...</p>
        `}
      </div>
    `}bindTeamProposalEvents(){const t=this.gameState;if(t.playerOrder[t.currentLeaderIndex]!==y.playerId)return;const s=t.playerOrder.length,a=D[s][t.currentMission];document.querySelectorAll(".game-player-item[data-player-id]").forEach(n=>{n.addEventListener("click",()=>{const i=n.dataset.playerId,o=this.selectedTeam.indexOf(i);o>=0?(this.selectedTeam.splice(o,1),n.classList.remove("player-selected")):this.selectedTeam.length<a&&(this.selectedTeam.push(i),n.classList.add("player-selected"));const r=document.getElementById("btn-propose");r&&(r.textContent=gt(this.selectedTeam.length,a),r.disabled=this.selectedTeam.length!==a)})}),document.getElementById("btn-propose")?.addEventListener("click",async()=>{const n=document.getElementById("btn-propose");n.disabled=!0,n.textContent="제안 중...",await _(d(m,`rooms/${this.roomCode}/actions/teamProposal`),{leaderId:y.playerId,members:[...this.selectedTeam]}),this.selectedTeam=[]})}renderVoting(){const t=this.gameState,e=t.playerOrder,s=t.currentLeaderIndex,a=t.teamProposal,n=e.length,i=J.render(n,t.missionResults,t.currentMission),o=w.render(this.players,e,s,{teamMembers:a?.members||[]}),r=this.players[a?.leaderId]?.name||"???";return`
      <div class="voting-phase fade-in">
        ${i}
        <div class="phase-info">
          <h3>미션 ${t.currentMission+1} — 팀 투표 ${this._renderTimerHtml()}</h3>
          <p class="text-muted">리더 <strong class="text-gold">${w.escapeHtml(r)}</strong>의 팀 제안</p>
        </div>
        ${o}
        <div class="vote-buttons mt-lg" id="vote-buttons" style="display:${this.hasVoted?"none":"grid"}">
          <button class="btn btn-good" id="btn-approve">찬성</button>
          <button class="btn btn-evil" id="btn-reject">반대</button>
        </div>
        <button class="btn btn-outline btn-full mt-lg vote-complete-btn" id="vote-complete-btn" style="display:${this.hasVoted?"flex":"none"}" disabled>
          ${qt()}
        </button>
        <p class="text-center text-muted mt-sm" id="vote-status" style="display:${this.hasVoted?"block":"none"}">
          ${this.hasVoted?`투표가 완료되었습니다!<br>당신의 선택은 <strong>${this.submittedVote==="approve"?"찬성":"반대"}</strong>입니다.`:Wt()}
        </p>
        <div class="progress-indicator mt-md">
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" id="vote-progress-bar" style="width:${Math.round(this.voteCount/e.length*100)}%"></div>
          </div>
          <span class="progress-text" id="vote-progress">${this.voteCount} / ${e.length}</span>
        </div>
      </div>
    `}bindVotingEvents(){if(this.hasVoted)return;const t=document.getElementById("btn-approve"),e=document.getElementById("btn-reject"),s=async a=>{if(this.hasVoted)return;this.hasVoted=!0,this.submittedVote=a,t.disabled=!0,e.disabled=!0;const n=document.getElementById("vote-buttons");n&&(n.style.display="none");const i=document.getElementById("vote-complete-btn");i&&(i.style.display="flex");const o=document.getElementById("vote-status");o&&(o.style.display="block",o.innerHTML=`투표가 완료되었습니다!<br>당신의 선택은 <strong>${a==="approve"?"찬성":"반대"}</strong>입니다.`),await P.submitVote(this.roomCode,y.playerId,a)};t?.addEventListener("click",()=>s("approve")),e?.addEventListener("click",()=>s("reject"))}renderVoteResult(){const t=this.gameState,e=t.playerOrder,s=t.currentLeaderIndex,a=t.voteResult,n=!!a?.playerVotes,i=w.render(this.players,e,s,{showVotes:n,votes:a?.playerVotes||{},teamMembers:t.teamProposal?.members||[]}),o=Yt.render(a,this.players);return`
      <div class="vote-result-phase fade-in">
        <div class="phase-info">
          <h3>팀 구성 결과 ${this._renderTimerHtml()}</h3>
        </div>
        ${o}
        ${i}
        <p class="text-center text-muted mt-xl" id="ready-progress">대기 중 (${this.readyPhaseCount}/${e.length})</p>
        <button class="btn btn-primary btn-full mt-sm" id="btn-ready">${this.hasConfirmedNext?tt():Kt()}</button>
      </div>
    `}bindVoteResultEvents(){document.getElementById("btn-ready")?.addEventListener("click",async()=>{const t=document.getElementById("btn-ready");t.disabled=!0,t.textContent=tt(),this.hasConfirmedNext=!0;const e=document.getElementById("ready-progress"),s=Q(this.gameState?.playerOrder||[],this.gameState?.readyPlayers||{},y.playerId,!0);e&&(e.textContent=`대기 중 (${s.readyCount}/${s.total})`),await P.submitReady(this.roomCode,y.playerId)})}renderMission(){const t=this.gameState,e=t.teamProposal,s=e?.members?.includes(y.playerId),a=this.privateData.team,n=t.playerOrder.length,i=t.currentMission,o=ut(n,i),r=J.render(n,t.missionResults,i),c=zt(),u=e?.members?.length||0;return s?`
      <div class="mission-phase fade-in">
        ${r}
        <div class="phase-info">
          <h3>미션 카드 제출 ${this._renderTimerHtml()}</h3>
          <p class="text-muted">성공 또는 실패 카드를 제출하세요</p>
          ${o>1?`<p class="text-gold" style="font-size:var(--font-size-sm)">이 미션은 실패 ${o}장 이상이어야 실패합니다</p>`:""}
        </div>
        <div class="mission-buttons" id="mission-buttons">
          <button class="btn btn-good mission-btn" id="btn-success">
            <span class="mission-btn-icon">&#10003;</span>
            <span>${c.success}</span>
          </button>
          <button class="btn btn-evil mission-btn" id="btn-fail" ${a==="good"?'disabled title="선의 세력은 성공만 제출 가능"':""}>
            <span class="mission-btn-icon">&#10007;</span>
            <span>${c.fail}</span>
          </button>
        </div>
        ${a==="good"?'<p class="text-center text-muted mt-sm">선의 세력은 성공 카드만 제출할 수 있습니다.</p>':""}
        <p class="text-center text-muted mt-sm" id="mission-status" style="display:none">카드 제출 완료. 결과 대기 중...</p>
        <div class="progress-indicator mt-md">
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" id="mission-progress-bar" style="width:${u>0?Math.round(this.missionCardCount/u*100):0}%"></div>
          </div>
          <span class="progress-text" id="mission-progress">${this.missionCardCount} / ${u}</span>
        </div>
      </div>
    `:`
        <div class="mission-phase fade-in">
          ${r}
          <div class="phase-info">
            <h3>미션 ${i+1} 수행 중 ${this._renderTimerHtml()}</h3>
            <p class="text-muted">팀원들이 미션을 수행하고 있습니다...</p>
          </div>
          <div class="flex-center mt-xl"><div class="spinner"></div></div>
          <div class="progress-indicator mt-md">
            <span class="text-muted">미션 카드 제출: </span>
            <span class="text-gold" id="mission-progress">${this.missionCardCount} / ${u}</span>
          </div>
        </div>
      `}bindMissionEvents(){if(this.hasSubmittedCard)return;const t=document.getElementById("btn-success"),e=document.getElementById("btn-fail"),s=async a=>{if(this.hasSubmittedCard)return;this.hasSubmittedCard=!0,t&&(t.disabled=!0),e&&(e.disabled=!0);const n=document.getElementById("mission-buttons");n&&(n.style.display="none");const i=document.getElementById("mission-status");i&&(i.style.display="block"),await P.submitMissionCard(this.roomCode,y.playerId,a)};t?.addEventListener("click",()=>s("success")),e?.addEventListener("click",()=>s("fail"))}renderMissionResult(){const t=this.gameState,e=t.missionResult,s=t.playerOrder.length,a=J.render(s,t.missionResults,t.currentMission),n=e?.success;return`
      <div class="mission-result-phase fade-in">
        ${a}
        <div class="phase-info">
          <h3>미션 ${t.currentMission} 결과 ${this._renderTimerHtml()}</h3>
        </div>
        <div class="result-display ${n?"result-success":"result-fail"}">
          <h2>${n?"미션 성공":"미션 실패"}</h2>
          <div class="result-cards">
            <span class="text-good">성공 ${e?.successCount||0}장</span>
            <span class="text-muted">/</span>
            <span class="text-evil">실패 ${e?.failCount||0}장</span>
        </div>
        </div>
        <p class="text-center text-muted mt-xl" id="ready-progress">대기 중 (${this.readyPhaseCount}/${s})</p>
        <button class="btn btn-primary btn-full mt-sm" id="btn-ready">${lt(this.hasConfirmedNext)}</button>
      </div>
    `}bindMissionResultEvents(){document.getElementById("btn-ready")?.addEventListener("click",async()=>{const t=document.getElementById("btn-ready");t.disabled=!0,t.textContent=lt(!0),this.hasConfirmedNext=!0,await P.submitReady(this.roomCode,y.playerId)})}renderAssassination(){const t=this.gameState,e=this.privateData.role===g.ASSASSIN;t.playerOrder;const s=this.privateData.assassinTargets||[];return e?`
      <div class="assassination-phase fade-in">
        <div class="phase-info">
          <h2 class="text-evil">멀린을 지목하세요 ${this._renderTimerHtml()}</h2>
          <p class="text-muted mt-sm">선의 세력 중 멀린이라고 생각되는 1명을 선택하세요</p>
        </div>
        <ul class="assassination-list">
          ${s.map(a=>{const n=this.players[a];return`
              <li class="assassination-target" data-target-id="${a}">
                ${w.escapeHtml(n?.name||"???")}
              </li>
            `}).join("")}
        </ul>
        <button class="btn btn-evil btn-full mt-lg" id="btn-assassinate" disabled>
          암살 대상을 선택하세요
        </button>
      </div>
    `:`
        <div class="assassination-phase fade-in">
          <div class="phase-info">
            <h2 class="text-gold">암살 단계</h2>
            <p class="text-muted mt-sm">선의 세력이 미션 3회에 성공했습니다.</p>
            <p class="text-muted">암살자가 멀린을 지목하는 중...</p>
          </div>
          <div class="flex-center mt-xl"><div class="spinner"></div></div>
        </div>
      `}bindAssassinationEvents(){if(this.privateData?.role!==g.ASSASSIN)return;let t=null;document.querySelectorAll(".assassination-target").forEach(e=>{e.addEventListener("click",()=>{document.querySelectorAll(".assassination-target").forEach(a=>a.classList.remove("target-selected")),e.classList.add("target-selected"),t=e.dataset.targetId;const s=document.getElementById("btn-assassinate");if(s){const a=this.players[t]?.name||"???";s.textContent=`${a}을(를) 암살`,s.disabled=!1}})}),document.getElementById("btn-assassinate")?.addEventListener("click",async()=>{if(!t)return;const e=document.getElementById("btn-assassinate");e.disabled=!0,e.textContent="암살 중...",await P.submitAssassination(this.roomCode,t)})}_startTimerDisplay(){this._stopTimerDisplay(),this._updateTimerDisplay(),this._timerInterval=setInterval(()=>this._updateTimerDisplay(),1e3)}_stopTimerDisplay(){this._timerInterval&&(clearInterval(this._timerInterval),this._timerInterval=null)}_updateTimerDisplay(){const t=document.getElementById("phase-timer");if(!t||!this.gameState?.phaseDeadline){t&&(t.style.display="none");return}const e=Math.max(0,Math.ceil((this.gameState.phaseDeadline-Date.now())/1e3));if(e<=0){t.textContent="시간 초과",t.classList.add("timer-expired");return}const s=Math.floor(e/60),a=e%60;t.textContent=s>0?`${s}:${String(a).padStart(2,"0")}`:`${a}초`,t.style.display="inline-block",t.classList.toggle("timer-warning",e<=10)}_renderTimerHtml(){return this.gameState?.phaseDeadline?'<span class="phase-timer" id="phase-timer"></span>':""}bindChatEvents(){const t=document.getElementById("floating-chat-form"),e=document.getElementById("floating-chat-input");t?.addEventListener("submit",async s=>{s.preventDefault();const a=e?.value;if(!a?.trim())return;e.value="";const n=this.players[y.playerId]?.name||"???";await ft.sendMessage(this.roomCode,y.playerId,n,a)})}addFloatingBubble(t){const e=document.getElementById("floating-chat-bubbles");if(!e)return;const s=t.playerId===y.playerId,a=w.escapeHtml(t.playerName),n=w.escapeHtml(t.text),i=document.createElement("div");for(i.className=`floating-bubble ${s?"floating-bubble-me":""}`,i.innerHTML=`<span class="floating-bubble-name">${a}</span> ${n}`,e.appendChild(i);e.children.length>6;)e.removeChild(e.firstChild);setTimeout(()=>{i.classList.add("floating-bubble-fade"),setTimeout(()=>i.remove(),1e3)},5e3)}bindAudioEvents(){document.getElementById("audio-toggle-btn")?.addEventListener("click",()=>{const t=B.toggleMute(),e=document.getElementById("audio-toggle-btn");e&&(e.innerHTML=t?"&#128263;":"&#128266;"),t||B.startBGM()})}bindVoteHistoryEvents(){const t=document.getElementById("vote-history-btn"),e=document.getElementById("vote-history-overlay");!t||!e||(t.addEventListener("click",()=>{this.updateVoteHistoryPanel(),e.classList.add("vote-history-visible")}),e.addEventListener("click",s=>{s.target===e&&e.classList.remove("vote-history-visible")}))}updateVoteHistoryPanel(){const t=document.getElementById("vote-history-panel");if(!t)return;const e=this.gameState?.voteHistory||[],s=this.gameState?.playerOrder||[];if(e.length===0){t.innerHTML=`
        <div class="vote-history-header">
          <h3>투표 기록</h3>
        </div>
        <p class="text-center text-muted" style="padding:var(--spacing-xl)">아직 투표 기록이 없습니다.</p>
      `;return}const a={};for(const i of e){const o=i.mission;a[o]||(a[o]=[]),a[o].push(i)}let n=`
      <div class="vote-history-header">
        <h3>투표 기록</h3>
      </div>
      <div class="vote-history-scroll">
    `;for(const[i,o]of Object.entries(a)){n+='<div class="vote-history-mission-group">',n+=`<div class="vote-history-mission-title">미션 ${Number(i)+1}</div>`,n+='<div class="vote-history-table-wrap"><table class="vote-history-table">',n+='<thead><tr><th class="vote-history-name-col"></th>';for(let r=0;r<o.length;r++){const c=o[r],u=this.players[c.leaderId]?.name||"???";n+=`<th class="vote-history-round-col ${c.approved?"vh-approved":"vh-rejected"}">
          <div class="vh-round-num">${r+1}차</div>
          <div class="vh-leader">${w.escapeHtml(u)}</div>
          <div class="vh-team">${(c.teamMembers||[]).map(p=>w.escapeHtml(this.players[p]?.name||"?")).join(", ")}</div>
        </th>`}n+="</tr></thead><tbody>";for(const r of s){const c=this.players[r]?.name||"???";n+=`<tr><td class="vote-history-name-col">${w.escapeHtml(c)}</td>`;for(const u of o){const p=u.playerVotes?.[r];p==="approve"?n+='<td class="vh-vote vh-vote-approve">O</td>':p==="reject"?n+='<td class="vh-vote vh-vote-reject">X</td>':n+='<td class="vh-vote">-</td>'}n+="</tr>"}n+="</tbody></table></div></div>"}n+="</div>",t.innerHTML=n}destroy(){this._stopTimerDisplay(),this.clearHostMigrationTimer(),this.clearPhaseListeners(),this.unsubscribers.forEach(t=>{typeof t=="function"&&t()}),this.engine&&this.engine.destroy(),B.stopBGM(),V.stopListening()}}function Qt(l){return l?l.meta?.status==="waiting"?{route:"lobby"}:l.gameState?{route:"result"}:{route:"/"}:{route:"/"}}class te{constructor(t){this.roomCode=t,this.container=document.getElementById("app"),this.unsubscribers=[],this.expandedVoteHistory=new Set([1])}render(){this.container.innerHTML=`
      <div class="view result-view fade-in">
        <div id="result-content">
          <div class="flex-center"><div class="spinner"></div></div>
        </div>
      </div>
    `,this.subscribe()}subscribe(){const t=A.onRoomChange(this.roomCode,e=>{const s=Qt(e);if(s.route==="/"){R.navigate("/");return}if(s.route==="lobby"){R.navigate("/lobby/"+this.roomCode);return}this.renderResult(e)});this.unsubscribers.push(t)}renderVoteHistorySection(t,e,s){if(!t||t.length===0)return"";const a={};for(const i of t){const o=i.mission;a[o]||(a[o]=[]),a[o].push(i)}let n="";for(const[i,o]of Object.entries(a)){const r=Number(i)+1,c=this.expandedVoteHistory.has(r);n+=`<section class="vote-history-mission-group ${c?"is-open":""}" data-mission-group="${r}">`,n+=`
        <button class="vote-history-mission-title" type="button" data-mission-toggle="${r}" aria-expanded="${c?"true":"false"}">
          <span>미션 ${r}</span>
          <span class="vote-history-toggle-icon">${c?"-":"+"}</span>
        </button>
      `,n+=`<div class="vote-history-table-wrap" style="display:${c?"block":"none"}"><table class="vote-history-table">`,n+='<thead><tr><th class="vote-history-name-col"></th>';for(let u=0;u<o.length;u++){const p=o[u],v=s[p.leaderId]?.name||"???";n+=`<th class="vote-history-round-col ${p.approved?"vh-approved":"vh-rejected"}">
          <div class="vh-round-num">${u+1}차</div>
          <div class="vh-leader">${w.escapeHtml(v)}</div>
          <div class="vh-team">${(p.teamMembers||[]).map(b=>w.escapeHtml(s[b]?.name||"?")).join(", ")}</div>
        </th>`}n+="</tr></thead><tbody>";for(const u of e){const p=s[u]?.name||"???";n+=`<tr><td class="vote-history-name-col">${w.escapeHtml(p)}</td>`;for(const v of o){const b=v.playerVotes?.[u];b==="approve"?n+='<td class="vh-vote vh-vote-approve">O</td>':b==="reject"?n+='<td class="vh-vote vh-vote-reject">X</td>':n+='<td class="vh-vote">-</td>'}n+="</tr>"}n+="</tbody></table></div></section>"}return`
      <div class="result-vote-history card">
        <h3 class="text-center mb-md" style="color:var(--color-gold)">투표 기록</h3>
        ${n}
      </div>
    `}renderResult(t){const e=t.gameState,s=t.players||{},{winner:a,winReason:n,roleReveal:i,missionResults:o,playerOrder:r}=e,c=a==="good",u=c?"선의 세력 승리":"악의 세력 승리",p=c?"text-good":"text-evil",v=t.meta?.hostId===y.playerId,b=r?.length||Object.keys(s).length,x=J.render(b,o||[],5);let $="";i&&r&&($=`
        <div class="result-roles card">
          <h3 class="text-center mb-md">전체 역할 공개</h3>
          <ul class="result-role-list">
            ${r.map(I=>{const C=s[I],k=i[I];if(!C||!k)return"";const T=st[k.role],H=k.team==="good"?"badge-good":"badge-evil";return`
                <li class="result-role-item">
                  <span class="result-player-name">${w.escapeHtml(C.name)}</span>
                  <span class="badge ${H}">${T?.name||k.role}</span>
                </li>
              `}).join("")}
          </ul>
        </div>
      `);const O=this.renderVoteHistorySection(e.voteHistory,r||[],s),L=document.getElementById("result-content");L.innerHTML=`
      <div class="result-hero ${c?"result-good":"result-evil"}">
        <h1 class="${p}">${u}</h1>
        <p class="result-reason">${n||""}</p>
      </div>
      ${x}
      ${$}
      ${O}
      <div class="result-actions mt-xl">
        <button class="btn btn-primary btn-full" id="btn-replay">${v?"다시 하기":"로비로 이동"}</button>
        <button class="btn btn-outline btn-full" id="btn-home">홈으로</button>
      </div>
    `,document.getElementById("btn-replay")?.addEventListener("click",async()=>{t.meta.hostId===y.playerId&&(await V.removeAllBotsFromPlayers(this.roomCode,t.players||{}),await f(d(m,`rooms/${this.roomCode}/meta`),{status:"waiting"}),await S(d(m,`rooms/${this.roomCode}/gameState`)),await S(d(m,`privateData/${this.roomCode}`)),await S(d(m,`rooms/${this.roomCode}/actions`)),await S(d(m,`rooms/${this.roomCode}/readyStatus`)),await S(d(m,`rooms/${this.roomCode}/chat`))),R.navigate("/lobby/"+this.roomCode)}),document.getElementById("btn-home")?.addEventListener("click",async()=>{await P.cancelPresence(this.roomCode,y.playerId),await A.leaveRoom(this.roomCode,y.playerId),y.roomCode=null,R.navigate("/")}),L.querySelectorAll("[data-mission-toggle]").forEach(I=>{I.addEventListener("click",()=>{const C=Number(I.dataset.missionToggle);C&&(this.expandedVoteHistory.has(C)?this.expandedVoteHistory.delete(C):this.expandedVoteHistory.add(C),this.renderResult(t))})})}destroy(){this.unsubscribers.forEach(t=>{typeof t=="function"&&t()})}}const y={playerId:null,playerName:null,roomCode:null};async function ee(){try{y.playerId=await kt()}catch(t){console.error("Firebase 인증 실패:",t),document.getElementById("app").innerHTML=`
      <div class="view flex-center">
        <p>서버 연결에 실패했습니다. 페이지를 새로고침해 주세요.</p>
      </div>
    `;return}const l=localStorage.getItem("avalon_playerName");l&&(y.playerName=l),R.addRoute("/",()=>new Dt),R.addRoute("/lobby",t=>new Jt(t)),R.addRoute("/game",t=>new Zt(t)),R.addRoute("/result",t=>new te(t)),R.start()}ee();
