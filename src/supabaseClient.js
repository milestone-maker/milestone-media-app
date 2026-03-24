import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cbpnjuotoxtmefmedpmj.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNicG5qdW90b3h0bWVmbWVkcG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDcwMTMsImV4cCI6MjA4OTkyMzAxM30.T6T8ACQPwnokeajrb47kbcQ82bauu4S1z1pb9wsv5OM';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
