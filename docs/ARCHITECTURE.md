# Architecture

## Overview

This project uses a monorepo with a Next.js customer-facing frontend and a FastAPI backend. The public site is statically rich and the order workflow is backed by an API that validates and persists requests.

## Concurrency notes

Order references, , and status transitions are intentionally protected with  optimistic version checks so duplicate requests and admin races do not cause inconsistent order state.

## Data flow

Customer request -> frontend validation -> POST /orders -> server validation -> DB transaction -> notifications -> admin dashboard updates.
