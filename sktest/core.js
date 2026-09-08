export function deviceStatus(nav,width,screenWidth) {
  const mobile=/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk/i.test(nav.userAgent||'')||nav.userAgentData?.mobile===true||(/Mac/.test(nav.platform||'')&&nav.maxTouchPoints>1)||(screenWidth>0&&screenWidth<768);
  return mobile?'mobile':width<1024?'narrow':'desktop';
}
export function remainingSeconds(deadline,now=Date.now()){return Math.max(0,Math.ceil((deadline-now)/1000));}
export function summarize(questions,answers) {
  const correct=questions.filter(q=>answers[q.id]===q.answer).length;
  const answered=questions.filter(q=>Number.isInteger(answers[q.id])).length;
  return {total:questions.length,correct,wrong:answered-correct,skipped:questions.length-answered,percent:questions.length?Math.round(correct/questions.length*100):0};
}
export function calculate(source) {
  const input=source.replace(/\s+/g,'').replaceAll('×','*').replaceAll('÷','/').replaceAll('−','-');
  if(!input||input.length>120||/[^0-9.+*/()\-]/.test(input))throw new Error('식을 확인해 주세요');
  let pos=0;
  function atom(){
    if(input[pos]==='+'){pos++;return atom();}
    if(input[pos]==='-'){pos++;return -atom();}
    if(input[pos]==='('){pos++;const n=expression();if(input[pos++]!==')')throw new Error('괄호를 확인해 주세요');return n;}
    const m=input.slice(pos).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if(!m)throw new Error('식을 확인해 주세요');pos+=m[0].length;return Number(m[0]);
  }
  function term(){let n=atom();while(input[pos]==='*'||input[pos]==='/'){const op=input[pos++],b=atom();if(op==='/'&&b===0)throw new Error('0으로 나눌 수 없어요');n=op==='*'?n*b:n/b;}return n;}
  function expression(){let n=term();while(input[pos]==='+'||input[pos]==='-'){const op=input[pos++],b=term();n=op==='+'?n+b:n-b;}return n;}
  const result=expression();if(pos!==input.length||!Number.isFinite(result))throw new Error('식을 확인해 주세요');return Number(result.toPrecision(12));
}
