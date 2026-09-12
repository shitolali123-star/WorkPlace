
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
  const job={
    id:Date.now(),
    title:form.title.value.trim(),
    category:form.category.value,
    description:form.description.value.trim(),
    price:form.price.value,
    location:form.location.value.trim(),
    deadline:form.deadline.value,
    postedBy:getUser().name,
    status:"Pending"
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
    <p class="muted">Deadline: ${escapeHtml(j.deadline)}</p>
    <button class="btn btn-purple" onclick="takeJob(${j.id})">Take Job →</button>
  </div>`).join("");
}

function takeJob(id){
  if(!requireLogin())return;
  const jobs=getJobs(); const j=jobs.find(x=>x.id===id); if(!j)return;
  alert(`You selected "${j.title}".\nWorker: ${getUser().name}\n\nDemo only: real job assignment will be connected to the database later.`);
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
  const f=e.target;const a=getAppeals();a.unshift({id:Date.now(),job:f.job.value.trim(),reason:f.reason.value.trim(),status:"Under Review",date:new Date().toLocaleDateString()});saveAppeals(a);f.reset();renderAppeals();alert("Appeal submitted successfully.");
}
function renderAppeals(){
  const box=document.getElementById("appealList");if(!box)return;
  const a=getAppeals();box.innerHTML=a.length?a.map(x=>`<div class="job"><h3>${escapeHtml(x.job)}</h3><p>${escapeHtml(x.reason)}</p><div class="tags"><span class="tag">${x.status}</span><span class="tag">${x.date}</span></div></div>`).join(""):'<div class="empty">No appeal history yet.</div>';
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

document.addEventListener("DOMContentLoaded",()=>{updateUserUI();seedDemoJobs();renderJobs();renderWorkers();renderAppeals();renderMyStats()});
