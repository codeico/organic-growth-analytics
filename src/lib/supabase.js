import { createClient } from "@supabase/supabase-js";
import { parsePublicEnv } from "./env.js";

const { supabaseUrl, supabaseKey } = parsePublicEnv(import.meta.env);

export const supabase = createClient(supabaseUrl, supabaseKey);
