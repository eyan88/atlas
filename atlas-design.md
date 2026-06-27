Project Brief: Institutional-Grade Dealer Positioning Analytics Platform
Overview

The goal is to build a professional-grade analytics platform for options dealer positioning that visualizes how dealer exposure evolves across strike prices and expirations.

The application is inspired by tools such as SpotGamma, TradingVolatility, and SqueezeMetrics, but differs in several key ways:

Preserve both the strike and expiration dimensions simultaneously instead of collapsing exposure into a single gamma curve.
Treat dealer positioning as a continuously evolving market state rather than a static daily chart.
Build a modular analytics engine capable of supporting many dealer metrics beyond Gamma Exposure.
Design the platform to eventually become a complete institutional trading dashboard integrating options positioning, market profile, and order flow.

The first version is intended for personal trading and research but should be architected so it could later support multiple users.

Vision

The application should answer questions such as:

Where is dealer positioning concentrated?
Which expiration is responsible for a key price level?
Which strikes are likely acting as dealer "magnets"?
How is dealer positioning evolving throughout the trading session?
How does dealer positioning align with auction market theory and market profile?

The system should emphasize visualization, replayability, extensibility, and performance.

Primary Visualization

The primary interface is a dealer positioning matrix.

Rows represent strike prices.

Columns represent expiration dates.

Each cell represents

(Ticker, Strike, Expiration)

Example:

            Expiration →

Strike 0DTE Weekly Monthly

620 +4.2B +0.8B +0.3B

619 -2.0B -1.2B +0.1B

618 +0.7B +2.8B +0.4B

Color:

Green = Positive dealer positioning

Red = Negative dealer positioning

Brightness = Percentile magnitude

A highlighted row should indicate the current underlying price.

Hovering over a cell reveals detailed metadata.

Supported Metrics

The visualization should not be limited to Gamma Exposure.

Each cell should be capable of displaying multiple dealer metrics.

Required metrics:

Net Gamma Exposure
Call Gamma
Put Gamma
Delta Exposure
Vanna
Charm
Call Open Interest
Put Open Interest
Total Open Interest
Open Interest Change
Today's Volume
Implied Volatility

The frontend should treat each metric as a generic scalar field.

Switching metrics should not require backend recalculation.

Historical Replay

A key differentiator of the platform.

Snapshots should be stored throughout the trading day.

The user should be able to replay dealer positioning over time using a timeline slider.

Future versions should support comparing multiple days.

Philosophy

The heatmap is only one visualization.

The real product is a dealer analytics engine.

The analytics engine computes market structure metrics.

The frontend simply visualizes them.

This separation allows new visualizations to be added without changing the backend.

Supported Markets

Initial:

SPY

QQQ

IWM

Architecture must support arbitrary optionable tickers.

Data Provider

Initial provider:

Polygon

The architecture must abstract market data behind an interface.

Future providers:

ThetaData

Databento

Interactive Brokers

Tradier

Switching providers should require only implementing a new adapter.

Dealer calculations must never depend directly on Polygon-specific models.

Data Requirements

Required data fields:

Underlying Price

Strike

Expiration

Option Type

Open Interest

Gamma

Delta

Implied Volatility

Volume

Greeks

The application should also store raw option chain snapshots so that new dealer metrics can be computed historically in the future.

Do not only store computed GEX.

Technology Stack

Backend

Python

FastAPI

NumPy

Pandas

SQLAlchemy

PostgreSQL

TimescaleDB

Redis

Background Workers

Celery or Dramatiq

Frontend

React

TypeScript

Vite

TailwindCSS

TanStack Query

Zustand

Heatmap Rendering

Canvas or PixiJS

Avoid SVG due to rendering performance with thousands of cells.

Charts

Plotly

Deployment

Docker

Docker Compose

Railway for MVP

DigitalOcean for production

Backend Philosophy

FastAPI should never perform expensive dealer calculations during requests.

Instead:

Background Worker

↓

Downloads option chain

↓

Calculates dealer metrics

↓

Stores results

↓

Caches current heatmap

↓

FastAPI simply serves cached data

The API should remain lightweight.

WebSockets

Avoid REST polling.

Frontend should receive updates through WebSockets.

Whenever a new snapshot is computed:

Only changed cells should be pushed.

Never resend the entire heatmap.

Database

Use PostgreSQL with TimescaleDB.

Store:

Raw Option Contracts

Dealer Metrics

Historical Snapshots

Current Heatmaps

Everything should be timestamped.

Optimize for historical replay.

Performance Goals

Initial page load

<2 seconds

Backend API

<100 ms

Heatmap updates

<100 ms

60 FPS rendering

Instant hover tooltips

Memory efficient rendering

Avoid React rendering thousands of components.

Use Canvas/PixiJS.

Frontend Requirements

The heatmap should support:

Smooth scrolling

Virtualization

Hover tooltips

Cell selection

Metric switching

Replay slider

Price overlay

Future:

Linked charts

Market profile overlays

Expected move overlays

Dealer gamma curve

Docker

The project should be fully containerized.

Separate containers:

Frontend

Backend

Worker

Redis

PostgreSQL

Nginx

Docker Compose should run the complete development environment.

The same images should deploy to Railway or DigitalOcean.

Cloud Deployment

Phase 1

Railway

Reason:

Fast deployment

Minimal DevOps

Managed PostgreSQL

Managed Redis

Automatic HTTPS

Phase 2

DigitalOcean

Single VPS

Docker Compose

Nginx

Long-term production deployment.

Future Platform Vision

The long-term goal is not simply a heatmap.

The application should evolve into a professional trading workstation integrating:

Dealer Positioning

Market Profile

Volume Profile

Auction Market Theory

Expected Move

Gamma Flip

Call Wall

Put Wall

Dealer Delta

Vanna

Charm

Options Flow

Liquidity Analysis

Historical Replay

Cross-ticker comparison

SPY

QQQ

IWM

Potential future integration:

Bookmap

DOM

Time & Sales

Order Flow

Architectural Principles

Modular

Highly testable

Provider-agnostic

Analytics separated from visualization

Strong type safety

Stateless API layer

Vectorized calculations

Time-series optimized database

Minimal frontend computation

Designed for extensibility

Requested Architecture Document

Produce a comprehensive software architecture document equivalent to an engineering design specification.

Include:

Executive Summary
Functional Requirements
Non-functional Requirements
High-Level System Architecture
Component Diagrams
Sequence Diagrams
Data Flow Diagrams
Backend Package Structure
Python Class Hierarchy
Provider Interfaces
Dealer Calculation Engine
Mathematical formulas for GEX, DEX, Vanna, Charm, Gamma Flip
Database Schema
ER Diagrams
Redis Strategy
FastAPI Endpoints
WebSocket Contracts
Frontend Component Hierarchy
Canvas/PixiJS Rendering Architecture
State Management Strategy
API Contracts
Docker Architecture
Docker Compose
Railway Deployment
DigitalOcean Deployment
GitHub Actions CI/CD
Testing Strategy
Monitoring
Logging
Performance Optimizations
Security Considerations
Repository Structure
MVP Roadmap
Future Roadmap

The document should be written at the level expected for a production software system and should enable another engineer to implement the project with minimal ambiguity.