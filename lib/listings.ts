import { supabase } from './supabase';

export type JobListing = {
  id: string;
  company: string;
  role: string;
  location: string | null;
  url: string | null;
  found_at: string;
  seen: boolean;
};

export async function fetchUnseenListings(): Promise<JobListing[]> {
  const { data, error } = await supabase
    .from('job_listings')
    .select('id, company, role, location, url, found_at, seen')
    .eq('seen', false)
    .order('found_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function markSeen(id: string): Promise<void> {
  const { error } = await supabase
    .from('job_listings')
    .update({ seen: true })
    .eq('id', id);

  if (error) throw error;
}
