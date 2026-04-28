import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/intro">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="Description will go into a meta tag in <head />">
      <HomepageHeader />
      <main>
        <section className={styles.features}>
          <div className="container">
            <div className="row">
              <div className="col col--4">
                <div className="text--center">
                  <h3>Easy to Use</h3>
                  <p>
                    Roulette Advisor AI was designed to make your betting experience
                    more informed and methodical.
                  </p>
                </div>
              </div>
              <div className="col col--4">
                <div className="text--center">
                  <h3>Intelligent Analysis</h3>
                  <p>
                    Our advanced AI algorithms analyze betting patterns to provide
                    optimal recommendations.
                  </p>
                </div>
              </div>
              <div className="col col--4">
                <div className="text--center">
                  <h3>Track Your Results</h3>
                  <p>
                    Keep track of your betting history and performance metrics
                    over time.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
