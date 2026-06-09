import { createClient } from '@supabase/supabase-js';

// Custom domain (Supabase Custom Domains add-on) — routes the whole project,
// incl. the Google OAuth authorize/callback, through our branded host so the
// Google sign-in screen shows "auth.milestonemediaphotography.com" instead of
// the raw cbpnjuotoxtmefmedpmj.supabase.co project URL. The original
// *.supabase.co URL still resolves to the same project if ever needed.
const supabaseUrl = 'https://auth.milestonemediaphotography.com';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNicG5qdW90b3h0bWVmbWVkcG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDcwMTMsImV4cCI6MjA4OTkyMzAxM30.T6T8ACQPwnokeajrb47kbcQ82bauu4S1z1pb9wsv5OM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
