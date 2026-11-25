mod mcp;
mod prompts;

use bloxd_core::init_or_open_project;
use clap::{Parser, Subcommand};
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Parser)]
#[command(name = "bloxd", version, about = "CLI & MCP server for bloxd architecture maps")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize .bloxd/ in the target directory (defaults to current directory)
    Init {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Initialize .bloxd/ if needed and launch bloxd-desktop opened to that directory
    Open {
        #[arg(default_value = ".")]
        path: PathBuf,
    },
    /// Print universal agent prompts to stdout
    Prompt {
        #[command(subcommand)]
        kind: PromptKind,
    },
    /// Start the stdio JSON-RPC 2.0 MCP server scoped to --project
    Mcp {
        #[arg(long, default_value = ".")]
        project: PathBuf,
    },
}

#[derive(Subcommand)]
enum PromptKind {
    /// Print instructions for mapping a repository into .bloxd/
    Map,
}

fn find_desktop_binary() -> PathBuf {
    let exe_name = if cfg!(windows) {
        "bloxd-desktop.exe"
    } else {
        "bloxd-desktop"
    };

    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            let sibling = dir.join(exe_name);
            if sibling.exists() {
                return sibling;
            }
        }
    }

    PathBuf::from(exe_name)
}

fn resolve_dir(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Init { path } => {
            let dir = resolve_dir(&path);
            match init_or_open_project(&dir) {
                Ok(snapshot) => {
                    println!(
                        "Initialized .bloxd/ for '{}' at {}",
                        snapshot.graph.project, snapshot.project_path
                    );
                }
                Err(e) => {
                    eprintln!("Error initializing .bloxd/: {e}");
                    std::process::exit(1);
                }
            }
        }

        Commands::Open { path } => {
            let dir = resolve_dir(&path);
            if let Err(e) = init_or_open_project(&dir) {
                eprintln!("Error preparing .bloxd/: {e}");
                std::process::exit(1);
            }

            let bin = find_desktop_binary();
            match Command::new(&bin).arg("--open").arg(&dir).spawn() {
                Ok(_) => println!("Launched {} for {}", bin.display(), dir.display()),
                Err(e) => {
                    eprintln!("Failed to launch {}: {e}", bin.display());
                    std::process::exit(1);
                }
            }
        }

        Commands::Prompt { kind } => match kind {
            PromptKind::Map => println!("{}", prompts::MAP_REPO_PROMPT),
        },

        Commands::Mcp { project } => {
            let dir = resolve_dir(&project);
            let stdin = io::stdin();
            let stdout = io::stdout();
            if let Err(e) = mcp::run_stdio_loop(stdin.lock(), stdout.lock(), &dir) {
                eprintln!("bloxd mcp error: {e}");
                std::process::exit(1);
            }
        }
    }
}
