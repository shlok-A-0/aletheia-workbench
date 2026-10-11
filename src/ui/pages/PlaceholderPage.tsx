import React from 'react';

interface PageProps {
  title: string;
  phase: string;
  description: string;
}

export const PlaceholderPage: React.FC<PageProps> = ({ title, phase, description }) => {
  return (
    <div className="page-container">
      <div className="page-header">
        <div className="badge">{phase}</div>
        <h1>{title}</h1>
        <p className="subtitle">{description}</p>
      </div>
      <div className="glass-card">
        <div className="card-header">
          <h3>Module Status</h3>
        </div>
        <p>This module will be populated as Phase {phase} is activated.</p>
      </div>
    </div>
  );
};
