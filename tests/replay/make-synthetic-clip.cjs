/* Builds a synthetic clip for checking the replay harness itself. It is NOT evidence about the real game:
   the text is drawn with Arial at the v1 crop positions on a flat background. Requires ffmpeg on PATH (or FFMPEG=...). */
const {execFileSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const outDir=path.resolve(__dirname,'../../validation/synthetic');fs.mkdirSync(outDir,{recursive:true});
const font='C\\:/Windows/Fonts/arialbd.ttf';
const menus=[
 {weapon:'Han 86',at:[4,10],military:8,special:3,completionist:'0/4',prestige:0},
 {weapon:'Kastov 762',at:[12,18],military:3,special:'0/3',completionist:'0/4',prestige:0},
];
const filters=['[0:v]format=yuv420p[v0]'];let n=0;
const add=f=>{filters.push(`[v${n}]${f}[v${n+1}]`);n++;};
for(const m of menus){
 const on=`enable='between(t,${m.at[0]},${m.at[1]})'`;
 const text=(t,x,y,size,color='white')=>add(`drawtext=fontfile='${font}':text='${t}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}:${on}`);
 add(`drawbox=x=0:y=0:w=iw:h=ih:color=0x10161c:t=fill:${on}`);
 text('CAMO SELECT',132,34,28);
 add(`drawbox=x=130:y=96:w=240:h=38:color=white:t=fill:${on}`);
 text(m.weapon.toUpperCase()+' PROGRESSION',136,105,19,'black');
 const fraction=(v,t)=>typeof v==='number'?v+'/'+t:v;
 text('MILITARY '+fraction(m.military,8),132,157,26);
 text('SPECIAL '+fraction(m.special,3),128,427,20);
 text('COMPLETIONIST '+fraction(m.completionist,4),128,618,17);
 text('PRESTIGE '+fraction(m.prestige,4),128,761,17);
}
const script=path.join(outDir,'filters.txt');fs.writeFileSync(script,filters.join(';\n'));
const clip=path.join(outDir,'synthetic-menus.mp4');
execFileSync(process.env.FFMPEG||'ffmpeg',['-y','-loglevel','error','-f','lavfi','-i','testsrc2=size=1920x1080:rate=30:duration=22','-/filter_complex',script,'-map',`[v${n}]`,'-c:v','libx264','-pix_fmt','yuv420p','-crf','20',clip],{stdio:'inherit'});
fs.writeFileSync(clip.replace(/\.mp4$/,'.json'),JSON.stringify({description:'Synthetic harness check (Arial text at v1 crop positions). Not game footage.',resolution:'1920x1080',menus,rewards:[]},null,2));
console.log('Wrote '+clip);
