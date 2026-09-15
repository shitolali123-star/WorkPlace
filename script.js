
const KEY="workPlaceJobs";
const USER_KEY="workPlaceUser";
const APPEAL_KEY="workPlaceAppeals";

function getJobs(){return JSON.parse(localStorage.getItem(KEY)||"[]")}
function saveJobs(jobs){localStorage.setItem(KEY,JSON.stringify(jobs))}
function getUser(){return JSON.parse(localStorage.getItem(USER_KEY)||"null")}
function setUser(user){localStorage.setItem(USER_KEY,JSON.stringify(user))}
function getAppeals(){return JSON.parse(localStorage.getItem(APPEAL_KEY)||"[]")}
function saveAppeals(a){localStorage.setItem(APPEAL_KEY,JSON.stringify(a))}

function updateUserUI(){
  const u=getUser();
  document.querySelectorAll(".user-name").forEach(el=>el.textContent=u?u.name:"User");
  document.querySelectorAll(".login-link").forEach(el=>{
    if(u){el.textContent="Logout";el.href="#";el.onclick=()=>{localStorage.removeItem(USER_KEY);location.href="index.html"}}
  });
}

function requireLogin(){
  if(!getUser()){alert("Please Login / Sign Up first.");location.href="login.html";return false}
  return true;
}

function postJob(e){
  e.preventDefault();
  if(!requireLogin()) return;
  const form=e.target;
  const mediaFiles=[...((form.photos&&form.photos.files)||[])];const videoFile=form.video&&form.video.files&&form.video.files[0];
  const maxPhoto=5*1024*1024,maxVideo=25*1024*1024;
  if(mediaFiles.length>5||mediaFiles.some(f=>f.size>maxPhoto)){alert('Maximum 5 photos, 5 MB each.');return}
  if(videoFile&&videoFile.size>maxVideo){alert('Video must be 25 MB or smaller.');return}
  const job={
    id:Date.now(),
    title:form.title.value.trim(),
    category:form.category.value,
    description:form.description.value.trim(),
    price:form.price.value,
    location:form.location.value.trim(),
    deadline:form.deadline.value,
    postedBy:getUser().name,
    status:"Pending", acceptedBy:null, acceptedAt:null,
    media:{photos:mediaFiles.map(f=>({name:f.name,size:f.size,type:f.type})),video:videoFile?{name:videoFile.name,size:videoFile.size,type:videoFile.type}:null}
  };
  if(!job.title||!job.category||!job.description||!job.price||!job.location||!job.deadline){
    alert("Please fill in all fields.");return;
  }
  const jobs=getJobs(); jobs.unshift(job); saveJobs(jobs);
  alert("Job posted successfully!");
  form.reset();
  document.getElementById("jobForm")?.classList.add("hidden");
  renderMyStats();
}

function renderMyStats(){
  const box=document.getElementById("myStats"); if(!box)return;
  const u=getUser(); const jobs=getJobs();
  const mine=u?jobs.filter(j=>j.postedBy===u.name):[];
  box.innerHTML=`<div class="stat pending"><span>Pending Jobs</span><b>${mine.filter(j=>j.status==="Pending").length}</b></div>
  <div class="stat completed"><span>Completed Jobs</span><b>${mine.filter(j=>j.status==="Completed").length}</b></div>
  <div class="stat uncompleted"><span>Uncompleted Jobs</span><b>${mine.filter(j=>j.status==="Uncompleted").length}</b></div>`;
}

function showPostForm(){
  if(!requireLogin()) return;
  const f=document.getElementById("jobForm"); if(f){f.classList.remove("hidden");f.scrollIntoView({behavior:"smooth"})}
}

function closePostForm(){document.getElementById("jobForm")?.classList.add("hidden")}

function seedDemoJobs(){
  if(getJobs().length)return;
  saveJobs([
    {id:1,title:"House Cleaning",category:"Cleaning",description:"Need a cleaner for a 2-bedroom home.",price:"1500",location:"Rajshahi",deadline:"2026-09-15",postedBy:"Rahim",status:"Pending"},
    {id:2,title:"Online Data Entry",category:"Virtual / Online",description:"Simple data entry work from home.",price:"2500",location:"Online",deadline:"2026-09-18",postedBy:"Karim",status:"Pending"},
    {id:3,title:"Electric Wiring",category:"Electrician",description:"Small house wiring repair.",price:"2000",location:"Dhaka",deadline:"2026-09-13",postedBy:"Hasan",status:"Pending"},
    {id:4,title:"Food Delivery",category:"Delivery",description:"Deliver food within the local area.",price:"800",location:"Chattogram",deadline:"2026-09-12",postedBy:"Sakib",status:"Pending"},
    {id:5,title:"Garden Cleaning",category:"Gardening",description:"Clean and organize a small garden.",price:"1200",location:"Rajshahi",deadline:"2026-09-20",postedBy:"Nayeem",status:"Pending"}
  ]);
}

function renderJobs(){
  const list=document.getElementById("jobList"); if(!list)return;
  const q=(document.getElementById("search")?.value||"").toLowerCase();
  const cat=document.getElementById("categoryFilter")?.value||"";
  const loc=(document.getElementById("locationFilter")?.value||"").toLowerCase();
  const jobs=getJobs().filter(j=>(j.title+j.description+j.category+j.location).toLowerCase().includes(q)&&(!cat||j.category===cat)&&(!loc||j.location.toLowerCase().includes(loc)));
  if(!jobs.length){list.innerHTML='<div class="empty">No jobs found.</div>';return}
  list.innerHTML=jobs.map(j=>`<div class="job">
    <h3>${escapeHtml(j.title)}</h3><div class="muted">${escapeHtml(j.postedBy)}</div>
    <div class="tags"><span class="tag">${escapeHtml(j.category)}</span><span class="tag">${escapeHtml(j.location)}</span></div>
    <p>${escapeHtml(j.description)}</p><div class="price">৳${escapeHtml(j.price)}</div>
    <p class="muted">Deadline: ${escapeHtml(j.deadline)}</p>${j.media?.photos?.length?`<div class="media-preview"><span class="media-chip">📷 ${j.media.photos.length} photo(s)</span>${j.media.video?`<span class="media-chip">🎥 ${escapeHtml(j.media.video.name)}</span>`:''}</div>`:''}<button class="btn btn-purple" onclick="takeJob(${j.id})" ${j.status!=='Pending'?'disabled':''}>${j.status==='Pending'?'Take Job →':escapeHtml(j.status)}</button>
  </div>`).join("");
}

function takeJob(id){
  if(!requireLogin())return;
  const jobs=getJobs(); const j=jobs.find(x=>x.id===id); if(!j)return;
  if(j.status!=='Pending'){alert('This job is no longer available.');return}
  if(new Date(j.deadline).getTime()<Date.now()){j.status='Expired';saveJobs(jobs);renderJobs();alert('This job deadline has already expired.');return}
  j.status='Accepted';j.acceptedBy=getUser().name;j.acceptedAt=new Date().toISOString();saveJobs(jobs);renderJobs();
  alert(`Job accepted successfully.\n\nWorker: ${getUser().name}\nDeadline: ${j.deadline}\n\nThe client can no longer cancel this job. The job will expire automatically if it is not completed before the deadline.`);
}

function renderWorkers(){
  const list=document.getElementById("workerList");if(!list)return;
  const q=(document.getElementById("workerSearch")?.value||"").toLowerCase();
  const workers=[
    ["Abdul Karim","Electrician","4.9","Rajshahi",25],
    ["Rahim Ahmed","Cleaning","4.7","Dhaka",18],
    ["Sakib Hasan","Delivery","4.8","Chattogram",31],
    ["Nayeem Islam","Gardening","4.6","Rajshahi",14],
    ["Jahid Hasan","Photography","4.9","Dhaka",22],
    ["Karim Mia","Plumbing","4.5","Narayanganj",12]
  ].filter(w=>w.join(" ").toLowerCase().includes(q));
  list.innerHTML=workers.length?workers.map(w=>`<div class="worker"><div class="icon orange">👷</div><h3>${w[0]}</h3><p><b>${w[1]}</b></p><p>⭐ ${w[2]} · ${w[4]} jobs</p><p class="muted">${w[3]}</p><button class="btn btn-orange" onclick="contactWorker('${w[0]}')">Contact Worker</button></div>`).join(""):'<div class="empty">No worker found.</div>';
}
function contactWorker(name){
  if(!requireLogin())return;
  alert(`You selected ${name}.\n\nDemo only: messaging/contact will be connected to the database later.`);
}
function addAppeal(e){
  e.preventDefault();if(!requireLogin())return;
  const f=e.target;const photos=[...((f.photos&&f.photos.files)||[])];const video=f.video&&f.video.files&&f.video.files[0];if(photos.length>5||photos.some(x=>x.size>5*1024*1024)){alert('Appeal photo limit: 5 files, 5 MB each.');return}if(video&&video.size>25*1024*1024){alert('Appeal video must be 25 MB or smaller.');return}const a=getAppeals();a.unshift({id:Date.now(),job:f.job.value.trim(),reason:f.reason.value.trim(),status:"Under Review",date:new Date().toLocaleDateString(),evidence:{photos:photos.map(x=>x.name),video:video?video.name:null}});saveAppeals(a);f.reset();renderAppeals();alert("Appeal submitted successfully.");
}
function renderAppeals(){
  const box=document.getElementById("appealList");if(!box)return;
  const a=getAppeals();box.innerHTML=a.length?a.map(x=>`<div class="job"><h3>${escapeHtml(x.job)}</h3><p>${escapeHtml(x.reason)}</p><div class="tags"><span class="tag">${x.status}</span><span class="tag">${x.date}</span>${x.evidence?.photos?.length?`<span class="tag">📷 ${x.evidence.photos.length}</span>`:''}${x.evidence?.video?`<span class="tag">🎥 Evidence</span>`:''}</div></div>`).join(""):'<div class="empty">No appeal history yet.</div>';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

document.addEventListener("DOMContentLoaded",()=>{updateUserUI();seedDemoJobs();renderJobs();renderWorkers();renderAppeals();renderMyStats()});

const COIN_BALANCE_KEY="workPlaceCoinBalance";const COIN_CHECKIN_KEY="workPlaceDailyCheckin";const COIN_STREAK_KEY="workPlaceDailyStreak";
function getCoins(){return Number(localStorage.getItem(COIN_BALANCE_KEY)||0)}
function setCoins(n){localStorage.setItem(COIN_BALANCE_KEY,String(Math.max(0,Math.floor(Number(n)||0))));document.querySelectorAll(".coin-balance").forEach(el=>el.textContent=getCoins().toLocaleString()+" Coins")}
function addCoins(n){setCoins(getCoins()+Number(n||0))}
function getCoinSettings(){try{return JSON.parse(localStorage.getItem("workPlaceCoinSettings")||"{}")}catch{return {}}}
function getSchedule(){const s=getCoinSettings();let a=Array.isArray(s.dailySchedule)?s.dailySchedule:[];if(a.length<60)a=Array.from({length:60},(_,i)=>Number(a[i]??(i===0?5:Math.min(100,5+i*2))));return a.map(x=>Math.max(0,Number(x)||0))}
function getConversionRate(){const s=getCoinSettings();return Math.max(1,Number(s.coinsPerBDT??100))}
function claimDailyCoins(){const today=new Date().toISOString().slice(0,10);if(localStorage.getItem(COIN_CHECKIN_KEY)===today){alert("Today's daily sign-in reward has already been claimed.");return false}const last=localStorage.getItem(COIN_CHECKIN_KEY);let streak=Number(localStorage.getItem(COIN_STREAK_KEY)||0);const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);streak=last===yesterday?Math.min(60,streak+1):1;const reward=getSchedule()[streak-1];addCoins(reward);localStorage.setItem(COIN_CHECKIN_KEY,today);localStorage.setItem(COIN_STREAK_KEY,String(streak));alert(`Day ${streak} reward claimed: +${reward} coins`);renderCoinWidgets();return true}
function renderCoinWidgets(){document.querySelectorAll(".coin-balance").forEach(el=>el.textContent=getCoins().toLocaleString()+" Coins");const streak=Number(localStorage.getItem(COIN_STREAK_KEY)||0);const schedule=getSchedule();const r=document.getElementById("dailyRate");if(r)r.textContent=`Day ${Math.max(1,Math.min(60,streak+1))}: ${schedule[Math.max(0,Math.min(59,streak))]} coins`;const v=document.getElementById("coinValue");if(v)v.textContent="৳"+(getCoins()/getConversionRate()).toFixed(2);const status=document.getElementById("checkinStatus");if(status){const today=new Date().toISOString().slice(0,10);status.textContent=localStorage.getItem(COIN_CHECKIN_KEY)===today?`Claimed — Day ${streak}`:`Available — next reward Day ${Math.max(1,streak+1)}`}}
function loadSupport(){const s=JSON.parse(localStorage.getItem('workPlaceSupportSettings')||'{}');document.querySelectorAll('#supportEmail').forEach(e=>e.textContent=s.email||'support@workplace.example');document.querySelectorAll('#supportPhone').forEach(e=>e.textContent=s.contact||'Admin-controlled support contact')}
document.addEventListener("DOMContentLoaded",()=>{renderCoinWidgets();loadSupport()});
