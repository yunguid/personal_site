import"./modulepreload-polyfill-B5Qt9EMX.js";class p{constructor(t,r,i){this.gl=t,this.program=this.createProgram(r.trim(),i.trim()),this.program&&(this.uniforms=this.getUniforms(this.program))}createProgram(t,r){const i=this.gl,o=this.compileShader(i.VERTEX_SHADER,t),s=this.compileShader(i.FRAGMENT_SHADER,r);if(!o||!s)return null;const u=i.createProgram();return i.attachShader(u,o),i.attachShader(u,s),i.linkProgram(u),i.getProgramParameter(u,i.LINK_STATUS)?u:(console.error("Program Link Error:",i.getProgramInfoLog(u)),null)}compileShader(t,r){const i=this.gl,o=i.createShader(t);return i.shaderSource(o,r),i.compileShader(o),i.getShaderParameter(o,i.COMPILE_STATUS)?o:(console.error("Shader Compile Error:",i.getShaderInfoLog(o)),i.deleteShader(o),null)}getUniforms(t){const r=this.gl,i={},o=r.getProgramParameter(t,r.ACTIVE_UNIFORMS);for(let s=0;s<o;s++){const u=r.getActiveUniform(t,s).name;i[u]=r.getUniformLocation(t,u)}return i}bind(){this.program&&this.gl.useProgram(this.program)}}function D(e,t,r,i){const o=e.createTexture();e.bindTexture(e.TEXTURE_2D,o),e.texImage2D(e.TEXTURE_2D,0,e.RGBA16F,t,r,0,e.RGBA,e.HALF_FLOAT,null);const s=i?e.LINEAR:e.NEAREST;return e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,s),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,s),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),o}function R(e,t,r,i){const o=D(e,t,r,i),s=e.createFramebuffer();return e.bindFramebuffer(e.FRAMEBUFFER,s),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,o,0),{fbo:s,texture:o,width:t,height:r,attach:u=>{e.activeTexture(e.TEXTURE0+u),e.bindTexture(e.TEXTURE_2D,o)}}}function T(e,t,r,i){let o=R(e,t,r,i),s=R(e,t,r,i);return{width:t,height:r,read:o,write:s,swap(){const u=this.read;this.read=this.write,this.write=u}}}const h={TEXTURE_DOWNSAMPLE:2,DENSITY_DISSIPATION:.99,VELOCITY_DISSIPATION:.99,PRESSURE_ITERATIONS:20,SPLAT_RADIUS:8e-4,SPLAT_FORCE:9e3},g=`#version 300 es\r
layout(location = 0) in vec2 aPosition;\r
out vec2 vUv;\r
\r
void main() {\r
    vUv = aPosition * 0.5 + 0.5;\r
    gl_Position = vec4(aPosition, 0.0, 1.0);\r
}\r
`,L=`#version 300 es\r
precision highp float;\r
\r
in vec2 vUv;\r
uniform sampler2D uVelocity;\r
uniform sampler2D uSource;\r
uniform vec2 uTexelSize;\r
uniform float dt;\r
uniform float uDissipation;\r
out vec4 FragColor;\r
\r
void main() {\r
    vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * uTexelSize;\r
    FragColor = texture(uSource, coord) * uDissipation;\r
}\r
`,M=`#version 300 es\r
precision highp float;\r
\r
in vec2 vUv;\r
uniform sampler2D uVelocity;\r
uniform vec2 uTexelSize;\r
out vec4 FragColor;\r
\r
void main() {\r
    float L = texture(uVelocity, vUv - vec2(uTexelSize.x, 0.0)).x;\r
    float R = texture(uVelocity, vUv + vec2(uTexelSize.x, 0.0)).x;\r
    float T = texture(uVelocity, vUv + vec2(0.0, uTexelSize.y)).y;\r
    float B = texture(uVelocity, vUv - vec2(0.0, uTexelSize.y)).y;\r
\r
    float div = 0.5 * (R - L + T - B);\r
    FragColor = vec4(div, 0.0, 0.0, 1.0);\r
}\r
`,k=`#version 300 es\r
precision highp float;\r
\r
in vec2 vUv;\r
uniform sampler2D uPressure;\r
uniform sampler2D uDivergence;\r
uniform vec2 uTexelSize;\r
out vec4 FragColor;\r
\r
void main() {\r
    float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;\r
    float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;\r
    float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;\r
    float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;\r
    float C = texture(uDivergence, vUv).x;\r
\r
    float p = (L + R + T + B - C) * 0.25;\r
    FragColor = vec4(p, 0.0, 0.0, 1.0);\r
}\r
`,N=`#version 300 es\r
precision highp float;\r
\r
in vec2 vUv;\r
uniform sampler2D uPressure;\r
uniform sampler2D uVelocity;\r
uniform vec2 uTexelSize;\r
out vec4 FragColor;\r
\r
void main() {\r
    float L = texture(uPressure, vUv - vec2(uTexelSize.x, 0.0)).x;\r
    float R = texture(uPressure, vUv + vec2(uTexelSize.x, 0.0)).x;\r
    float T = texture(uPressure, vUv + vec2(0.0, uTexelSize.y)).x;\r
    float B = texture(uPressure, vUv - vec2(0.0, uTexelSize.y)).x;\r
    vec2 velocity = texture(uVelocity, vUv).xy;\r
    velocity.xy -= vec2(R - L, T - B) * 0.5;\r
    FragColor = vec4(velocity, 0.0, 1.0);\r
}\r
`,O=`#version 300 es\r
precision highp float;\r
\r
in vec2 vUv;\r
uniform sampler2D uTarget;\r
uniform float uAspectRatio;\r
uniform vec2 uPoint;\r
uniform vec3 uColor;\r
uniform float uRadius;\r
out vec4 FragColor;\r
\r
void main() {\r
    vec2 p = vUv - uPoint.xy;\r
    p.x *= uAspectRatio;\r
    vec3 splat = exp(-dot(p, p) / uRadius) * uColor;\r
    vec3 base = texture(uTarget, vUv).xyz;\r
    FragColor = vec4(base + splat, 1.0);\r
}\r
`,$=`#version 300 es\r
precision highp float;\r
\r
in vec2 vUv;\r
uniform sampler2D uTexture;\r
out vec4 FragColor;\r
\r
vec3 palette(float t) {\r
    // Deep space blue palette\r
    vec3 a = vec3(0.0, 0.0, 0.05);\r
    vec3 b = vec3(0.2, 0.5, 1.0);\r
    // Non-linear mapping for "glowing" effect\r
    return mix(a, b, smoothstep(0.0, 1.0, t * 1.5));\r
}\r
\r
void main() {\r
    float density = texture(uTexture, vUv).x;\r
    vec3 color = palette(density);\r
    FragColor = vec4(color, 1.0);\r
}\r
`;let f,n,y,c,v,P,E,a={},l,d,A=performance.now();function z(e){const t=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,t),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,-1,1,1,1,1,-1]),e.STATIC_DRAW),e.bindBuffer(e.ARRAY_BUFFER,null);const r=e.createBuffer();return e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,r),e.bufferData(e.ELEMENT_ARRAY_BUFFER,new Uint16Array([0,1,2,0,2,3]),e.STATIC_DRAW),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,null),i=>{e.bindFramebuffer(e.FRAMEBUFFER,i?i.fbo:null),e.bindBuffer(e.ARRAY_BUFFER,t),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,r),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0),e.drawElements(e.TRIANGLES,6,e.UNSIGNED_SHORT,0)}}let m;function B(){f.width=window.innerWidth,f.height=window.innerHeight,l=Math.floor(f.width>>h.TEXTURE_DOWNSAMPLE),d=Math.floor(f.height>>h.TEXTURE_DOWNSAMPLE),c=T(n,l,d,y),v=T(n,l,d,y),P=R(n,l,d,y),E=T(n,l,d,y)}function I(e,t,r,i,o,s){a.splat.bind(),n.uniform1i(a.splat.uniforms.uTarget,0),n.uniform1f(a.splat.uniforms.uAspectRatio,l/d),n.uniform2f(a.splat.uniforms.uPoint,e,t),n.uniform3f(a.splat.uniforms.uColor,r*s,i*s,0),n.uniform1f(a.splat.uniforms.uRadius,h.SPLAT_RADIUS),c.read.attach(0),m(c.write),c.swap(),n.uniform3f(a.splat.uniforms.uColor,o[0],o[1],o[2]),n.uniform1i(a.splat.uniforms.uTarget,0),v.read.attach(0),m(v.write),v.swap()}function U(e){const t=Math.min((e-A)/1e3,.016);A=e,n.viewport(0,0,l,d);const r=e*.001;I(.5+Math.sin(r)*.2,.5+Math.cos(r*.8)*.2,Math.cos(r*2.5)*h.SPLAT_FORCE,Math.sin(r*2.5)*h.SPLAT_FORCE,[.1,.2,.8],t),I(.5+Math.cos(r*1.4)*.25,.5+Math.sin(r*1.2)*.25,Math.sin(r*3)*h.SPLAT_FORCE*.8,Math.cos(r*3)*h.SPLAT_FORCE*.8,[.05,.4,.9],t),a.advection.bind(),n.uniform1f(a.advection.uniforms.dt,t),n.uniform2f(a.advection.uniforms.uTexelSize,1/l,1/d),n.uniform1f(a.advection.uniforms.uDissipation,h.VELOCITY_DISSIPATION),n.uniform1i(a.advection.uniforms.uVelocity,0),n.uniform1i(a.advection.uniforms.uSource,0),c.read.attach(0),m(c.write),c.swap(),n.uniform1f(a.advection.uniforms.uDissipation,h.DENSITY_DISSIPATION),n.uniform1i(a.advection.uniforms.uVelocity,0),n.uniform1i(a.advection.uniforms.uSource,1),c.read.attach(0),v.read.attach(1),m(v.write),v.swap(),a.divergence.bind(),n.uniform2f(a.divergence.uniforms.uTexelSize,1/l,1/d),n.uniform1i(a.divergence.uniforms.uVelocity,0),c.read.attach(0),m(P),a.jacobi.bind(),n.uniform2f(a.jacobi.uniforms.uTexelSize,1/l,1/d),n.uniform1i(a.jacobi.uniforms.uDivergence,0),n.uniform1i(a.jacobi.uniforms.uPressure,1),P.attach(0);for(let i=0;i<h.PRESSURE_ITERATIONS;i++)E.read.attach(1),m(E.write),E.swap();a.gradientSubtract.bind(),n.uniform2f(a.gradientSubtract.uniforms.uTexelSize,1/l,1/d),n.uniform1i(a.gradientSubtract.uniforms.uPressure,0),n.uniform1i(a.gradientSubtract.uniforms.uVelocity,1),E.read.attach(0),c.read.attach(1),m(c.write),c.swap(),n.viewport(0,0,f.width,f.height),a.display.bind(),n.uniform1i(a.display.uniforms.uTexture,0),v.read.attach(0),m(null),requestAnimationFrame(U)}function W(){if(f=document.getElementById("glcanvas"),!f){console.error("Canvas element not found");return}if(n=f.getContext("webgl2"),!n){console.error("WebGL 2.0 not available"),document.body.innerHTML='<div style="color:white; text-align:center; padding-top:20px;">WebGL 2.0 is required</div>';return}n.getExtension("EXT_color_buffer_float"),y=n.getExtension("OES_texture_float_linear"),m=z(n);try{a.advection=new p(n,g,L),a.divergence=new p(n,g,M),a.jacobi=new p(n,g,k),a.gradientSubtract=new p(n,g,N),a.splat=new p(n,g,O),a.display=new p(n,g,$),B(),window.addEventListener("resize",B),requestAnimationFrame(U)}catch(e){console.error("Initialization failed:",e)}}const V=[{role:"AI Software Engineer",company:"Catalyst Operations & Analytics",url:"https://www.catalystops.com/",dates:"Jan 2025 - Present",description:"Built large-scale AI products addressing critical needs for government and defense-related clients. Projects include air-gapped bulk processing systems for multi-language audio and documents, real-time live transcription and translation engines, and advanced media processing tools."},{role:"Software Engineer Intern",company:"Quikirr",url:"https://quikirr.com/",dates:"May 2024 - Sep 2024",description:"Joined as the first engineer to build due diligence tools for Private Equity and Investment Banking."},{role:"Lead Developer (Contract)",company:"m_vis",url:"https://vangelis.yunguid.com/",dates:"May 2024 - Sep 2024",description:"Solely architected and built an AI assisted audio visualization platform. Delivered a full-stack solution that automates video generation from audio inputs."},{role:"Software Engineer Intern",company:"Jackpine Technologies",url:null,dates:"June 2023 - Aug 2023",description:"Automated QA testing and migrated cloud assets, improving test coverage and accuracy for Windows/Linux environments."}];function H(){const e=document.getElementById("work-container");e&&V.forEach(t=>{const r=document.createElement("div");r.className="resume-item";const i=t.url?`<h3 class="resume-role">${t.role} - <a href="${t.url}" target="_blank" class="link">${t.company}</a></h3>`:`<h3 class="resume-role">${t.role} - ${t.company}</h3>`;r.innerHTML=`
      ${i}
      <div class="resume-date">${t.dates}</div>
      <p class="resume-desc">${t.description}</p>
    `,e.appendChild(r)})}class w{constructor(t){this.data=t.data,this.itemsPerPage=t.itemsPerPage||3,this.currentPage=1,this.container=t.container,this.renderItem=t.renderItem,this.prevBtn=t.prevBtn,this.nextBtn=t.nextBtn,this.pageInfo=t.pageInfo,this.onPageChange=t.onPageChange||null,this.init()}get totalPages(){return Math.ceil(this.data.length/this.itemsPerPage)}get pageData(){const t=(this.currentPage-1)*this.itemsPerPage;return this.data.slice(t,t+this.itemsPerPage)}get startIndex(){return(this.currentPage-1)*this.itemsPerPage}init(){this.prevBtn&&this.prevBtn.addEventListener("click",()=>this.prev()),this.nextBtn&&this.nextBtn.addEventListener("click",()=>this.next()),this.render()}prev(){this.currentPage>1&&(this.currentPage--,this.render())}next(){this.currentPage<this.totalPages&&(this.currentPage++,this.render())}render(){this.container&&(this.container.innerHTML="",this.pageData.forEach((t,r)=>{const i=this.renderItem(t,this.startIndex+r);i&&this.container.appendChild(i)}),this.updateControls(),this.onPageChange&&this.onPageChange(this.pageData,this.startIndex))}updateControls(){this.pageInfo&&(this.pageInfo.textContent=`${this.currentPage} / ${this.totalPages}`),this.prevBtn&&(this.prevBtn.disabled=this.currentPage===1),this.nextBtn&&(this.nextBtn.disabled=this.currentPage===this.totalPages)}setData(t){this.data=t,this.currentPage=1,this.render()}}const X=[{title:"R. Schumann - Aufschwung",subtitle:"Northwell Health",url:"https://www.youtube.com/watch?v=mEEgSmhmkiA"},{title:"C. Debussy - Claire de Lune",subtitle:"",url:"https://youtu.be/chliWNkOIIs"},{title:"F. Chopin - Nocturne No. 2",subtitle:"E-Flat Major",url:"https://www.youtube.com/watch?v=mKvDlsbnnFM"},{title:"W. Mozart - Fantaisie D Minor",subtitle:"",url:"https://www.youtube.com/watch?v=8jmSxc9Xi1E&t=1s"},{title:"A. Dvorak - Violin Sonatina",subtitle:"Op 100, B. 183",url:"https://www.youtube.com/watch?v=D0DGwUpkVF4"}];function G(){const e=document.getElementById("piano-grid"),t=document.getElementById("piano-prev-btn"),r=document.getElementById("piano-next-btn"),i=document.getElementById("piano-page-info");e&&new w({data:X,itemsPerPage:2,container:e,prevBtn:t,nextBtn:r,pageInfo:i,renderItem:o=>{const s=document.createElement("a");return s.href=o.url,s.target="_blank",s.className="music-item",s.innerHTML=`
        <div class="font-medium" style="font-weight: 500;">${o.title}</div>
        ${o.subtitle?`<div style="font-size: 0.875rem; opacity: 0.6; margin-top: 0.25rem;">${o.subtitle}</div>`:""}
      `,s}})}const C='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>',Y='<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>',q='<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>',x=new Set;class j{constructor(t,r,i){this.container=t,this.track=r,this.index=i,this.audio=null,this.isPlaying=!1,this.render(),this.bindEvents()}generateWaveform(){return Array.from({length:50},()=>Math.floor(Math.random()*60)+5).map(t=>`<div class="waveform-bar" style="height: ${t}%"></div>`).join("")}render(){this.container.className="custom-audio-player",this.container.id=`player-${this.index}`,this.container.innerHTML=`
      <div class="audio-container">
        <div class="track-info">
          <span class="track-title">${this.track.title}</span>
          <span class="track-duration">${this.track.duration}</span>
        </div>
        <div class="waveform-container" id="waveform-${this.index}">
          ${this.generateWaveform()}
        </div>
        <div class="audio-controls">
          <button class="player-button play-pause-btn" data-player="${this.index}" aria-label="Play">
            ${C}
          </button>
          <div class="progress-container" id="progress-container-${this.index}">
            <div class="progress-bar" id="progress-bar-${this.index}"></div>
          </div>
          <div class="volume-container">
            <button class="player-button volume-btn" data-player="${this.index}" aria-label="Volume">
              ${q}
            </button>
            <input type="range" class="volume-slider" id="volume-${this.index}" min="0" max="1" step="0.1" value="0.7">
          </div>
        </div>
        <audio id="audio-${this.index}" preload="metadata">
          <source src="${this.track.url}" type="audio/mpeg">
        </audio>
      </div>
    `,this.audio=this.container.querySelector("audio"),this.playPauseBtn=this.container.querySelector(".play-pause-btn"),this.progressBar=this.container.querySelector(".progress-bar"),this.progressContainer=this.container.querySelector(".progress-container"),this.volumeSlider=this.container.querySelector(".volume-slider"),this.waveformContainer=this.container.querySelector(".waveform-container"),x.add(this)}bindEvents(){if(this.audio&&(this.audio.volume=.7,this.playPauseBtn.addEventListener("click",()=>this.togglePlay()),this.audio.addEventListener("timeupdate",()=>{const t=Number.isFinite(this.audio.duration)?this.audio.duration:0,r=t>0?this.audio.currentTime/t*100:0;this.progressBar.style.width=`${r}%`}),this.progressContainer.addEventListener("click",t=>{const r=t.offsetX/this.progressContainer.offsetWidth,i=Number.isFinite(this.audio.duration)?this.audio.duration:0;i>0&&(this.audio.currentTime=r*i)}),this.volumeSlider.addEventListener("input",()=>{const t=parseFloat(this.volumeSlider.value);this.audio.volume=Number.isFinite(t)?Math.max(0,Math.min(1,t)):.7}),this.audio.addEventListener("ended",()=>{this.pause(),this.progressBar.style.width="0%"}),"mediaSession"in navigator))try{navigator.mediaSession.metadata=new MediaMetadata({title:this.track.title,artist:"Luke Young"}),navigator.mediaSession.setActionHandler("play",()=>this.audio.play()),navigator.mediaSession.setActionHandler("pause",()=>this.audio.pause())}catch{}}togglePlay(){this.audio.paused?this.play():this.pause()}play(){x.forEach(t=>{t!==this&&!t.audio.paused&&t.pause()}),this.audio.play(),this.isPlaying=!0,this.playPauseBtn.innerHTML=Y,this.startWaveformAnimation()}pause(){this.audio.pause(),this.isPlaying=!1,this.playPauseBtn.innerHTML=C,this.stopWaveformAnimation()}startWaveformAnimation(){this.waveformContainer.querySelectorAll(".waveform-bar").forEach((r,i)=>{const o=i*.05;r.style.animation=`sound 0.5s ease-in-out infinite alternate ${o}s`,r.style.opacity="0.7"})}stopWaveformAnimation(){this.waveformContainer.querySelectorAll(".waveform-bar").forEach(r=>{r.style.animation="none",r.style.opacity="0.2"})}destroy(){x.delete(this),this.audio&&(this.audio.pause(),this.audio.src="")}}const J="https://lukemusicbucket.s3.us-east-2.amazonaws.com",K=[{title:"Sunrise",fileName:"SUNRISE.mp3",duration:"1:21"},{title:"Karlsim",fileName:"karlsim.mp3",duration:"1:03"},{title:"Romestreetz",fileName:"romestreetz.mp3",duration:"1:06"},{title:"Drivers",fileName:"ubr_drivers.mp3",duration:"0:58"},{title:"127",fileName:"baby2.mp3",duration:"1:15"}],Q={s3BaseUrl:J,tracks:K};let S=[];function Z(){const e=document.getElementById("production-list"),t=document.getElementById("prod-prev-btn"),r=document.getElementById("prod-next-btn"),i=document.getElementById("prod-page-info");if(!e)return;const{s3BaseUrl:o,tracks:s}=Q;new w({data:s,itemsPerPage:2,container:e,prevBtn:t,nextBtn:r,pageInfo:i,renderItem:(u,F)=>{const b=document.createElement("div"),_=new j(b,{title:u.title,duration:u.duration,url:`${o}/${u.fileName}`},F);return S.push(_),b},onPageChange:()=>{S.forEach(u=>u.destroy()),S=[]}})}const ee=[{title:"The Fountainhead",author:"Ayn Rand",isRead:!0},{title:"Atlas Shrugged",author:"Ayn Rand",isRead:!0},{title:"For the New Intellectual",author:"Ayn Rand",isRead:!1},{title:"The Lessons of History",author:"Will and Ariel Durant",isRead:!0},{title:"Intelligent Machines",author:"Ray Kurzweil",isRead:!1},{title:"Man and His Symbols",author:"Carl Jung",isRead:!0},{title:"Benjamin Franklin",author:"Carl Van Doren",isRead:!1},{title:"The Difference between God and Larry Ellison",author:"Mike Wilson",isRead:!1},{title:"Napoleon",author:"Vincent Cronin",isRead:!0},{title:"Metals and How To Weld Them",author:"T. B. Jefferson & Gorham Woods",isRead:!1},{title:"Astro Boy, Vol. 1",author:"Osamu Tezuka",isRead:!1},{title:"Focus: The ASML way",author:"Marc Hijink",isRead:!1},{title:"Crime and Punishment",author:"Fyodor Dostoevsky",isRead:!0},{title:"Cherry Orchard",author:"Anton Chekhov",isRead:!0},{title:"Uncle Vanya",author:"Anton Chekhov",isRead:!0},{title:"Journey to the Center of the Earth",author:"Jules Verne",isRead:!0},{title:"Consider Phlebas",author:"Iain M. Banks",isRead:!0},{title:"The Player of Games",author:"Iain M. Banks",isRead:!0}];function te(e){const t=[...e];for(let r=t.length-1;r>0;r--){const i=Math.floor(Math.random()*(r+1));[t[r],t[i]]=[t[i],t[r]]}return t}function re(){const e=document.getElementById("books-grid"),t=document.getElementById("prev-btn"),r=document.getElementById("next-btn"),i=document.getElementById("page-info");if(!e)return;const o=te(ee);new w({data:o,itemsPerPage:3,container:e,prevBtn:t,nextBtn:r,pageInfo:i,renderItem:s=>{const u=document.createElement("div");return u.className="book-card",u.innerHTML=`
        <div class="book-title">${s.title}</div>
        <div class="book-author">${s.author}</div>
        <div class="book-status ${s.isRead?"status-read":"status-toread"}">
          ${s.isRead?"Read":"To Read"}
        </div>
      `,u}})}function ie(){history.scrollRestoration&&(history.scrollRestoration="manual"),window.scrollTo(0,0),H(),G(),Z(),re()}"serviceWorker"in navigator&&navigator.serviceWorker.getRegistrations().then(e=>{e.forEach(t=>t.unregister())});document.addEventListener("DOMContentLoaded",()=>{W(),ie()});
