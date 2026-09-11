import {convexAuth} from '@convex-dev/auth/server';
import {Email} from '@convex-dev/auth/providers/Email';
import {RateLimiter,MINUTE} from '@convex-dev/rate-limiter';
import {components} from './_generated/api';
import type {ActionCtx} from './_generated/server';
const emailLimiter=new RateLimiter(components.rateLimiter,{emailCode:{kind:'token bucket',rate:3,period:15*MINUTE,capacity:3}});
export const {auth,signIn,signOut,store,isAuthenticated}=convexAuth({
 signIn:{maxFailedAttempsPerHour:5},
 providers:[Email({id:'resend',maxAge:10*60,
  generateVerificationToken:async()=>{
   // Rejection sampling avoids biased numeric codes. Web Crypto runs in Convex actions.
   const limit=4294000000;let n=limit;while(n>=limit)n=crypto.getRandomValues(new Uint32Array(1))[0];
   return String(n%1000000).padStart(6,'0');
  },
  sendVerificationRequest:async({identifier,token},ctx?:ActionCtx)=>{
   // Convex Auth supplies this second argument at runtime; its Auth.js type omits it.
   if(!ctx)throw new Error('Authentication context unavailable.');
   await emailLimiter.limit(ctx,'emailCode',{key:identifier.toLowerCase(),throws:true});
   const key=process.env.AUTH_RESEND_KEY;const from=process.env.TOGETHER_EMAIL_FROM;
   if(!key||!from)throw new Error('Email sign-in is not configured. Please contact the group leader.');
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:identifier,subject:'Your Together sign-in code',text:`Your Together sign-in code is ${token}. It expires in 10 minutes. If you did not request it, you can ignore this email.`})});
   if(!response.ok)throw new Error('Could not send your sign-in code. Please try again shortly.');
  }
 })]
});
