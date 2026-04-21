interface AccountPlaceholderPageProps {
  title: string;
}

export function AccountPlaceholderPage(props: AccountPlaceholderPageProps) {
  return (
    <section className="page account-placeholder-page">
      <h1 className="account-placeholder-page__title">{props.title}</h1>
    </section>
  );
}
