/* 常见问题使用整理好的公司资料，不调用实时模型。 */
(function(root){
  const routes=[
    {index:0,phrases:['核心战略','公司战略','华海战略']},
    {index:1,phrases:['全产销链','产销闭环','产销链']},
    {index:2,phrases:['ai小脑','ai大脑','小脑和大脑','技术路线']},
    {index:3,phrases:['爱买买和华海','爱买买是什么','爱买买的角色','爱买买关系','爱买买在华海生态中承担什么角色']},
    {index:4,phrases:['有哪些端','微信小程序','买家app','卖家后台','管理后台']},
    {index:5,phrases:['自动管理农场','自动控制设备','自动养殖','自动管理农业']},
    {index:6,phrases:['溯源','追溯']},
    {index:7,phrases:['大健康','健康生态']},
    {index:8,phrases:['消费积分','红包','数字资产']},
    {index:9,phrases:['已经上线','线上功能','已上线','实际可用']},
    {index:10,phrases:['治疗疾病','治病','疗效','治愈','医疗功效']},
    {index:11,phrases:['合作伙伴','如何合作','怎样合作','参与合作']},
  ];
  function answer(question,knowledge){
    const text=question.trim().toLowerCase().replace(/[\s，。？！、,.?!：:]/g,'');
    const exact=knowledge.faq.find(item=>item.q.toLowerCase().replace(/[\s，。？！、,.?!：:]/g,'')===text);
    if(exact)return{answer:exact.a,sources:['公司常见问题']};
    const matches=routes.filter(r=>r.phrases.some(p=>text.includes(p))).slice(0,2).map(r=>knowledge.faq[r.index]);
    if(matches.length)return{answer:matches.map(item=>item.a).join('\n\n'),sources:['公司常见问题']};
    const chapter=knowledge.chapters.find(ch=>text===ch.label.toLowerCase());
    if(chapter)return{answer:chapter.description+'\n'+chapter.points.join('；')+'。可以选择上方对应主题，查看完整讲稿或收听讲解。',sources:['主题讲解资料']};
    return{answer:'公司资料中还没有这个问题的说明。你可以选择上方六个讲解主题、点选常见问题，或通过官网联系华海了解更多。',sources:[]};
  }
  root.HuahaiFAQs={answer};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.HuahaiFAQs;
})(typeof globalThis!=='undefined'?globalThis:this);
