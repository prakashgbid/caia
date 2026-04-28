-- articles: published ones are public
create policy "articles_published_read" on public.articles
  for select using (
    status = 'published' or auth.uid() = author_id
  );

create policy "articles_author_create" on public.articles
  for insert with check (auth.uid() = author_id);

create policy "articles_author_update" on public.articles
  for update using (auth.uid() = author_id);

-- research papers
create policy "research_papers_published_read" on public.research_papers
  for select using (
    status = 'published' or auth.uid() = author_id
  );

create policy "research_papers_author_create" on public.research_papers
  for insert with check (auth.uid() = author_id);

create policy "research_papers_author_update" on public.research_papers
  for update using (
    auth.uid() = author_id or
    auth.uid() = any(reviewers)
  );

-- editorial reviews
create policy "reviews_participant_read" on public.editorial_reviews
  for select using (
    auth.uid() = reviewer_id or
    exists (
      select 1 from public.research_papers where id = paper_id and author_id = auth.uid()
    ) or
    exists (
      select 1 from public.articles where id = article_id and author_id = auth.uid()
    )
  );

create policy "reviews_reviewer_create" on public.editorial_reviews
  for insert with check (auth.uid() = reviewer_id);
