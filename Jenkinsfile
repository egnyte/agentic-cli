@Library(value = ['avalonlib', 'seclib', 'pintlib', 'kubernetes-lib']) _


pipeline {
    agent {
        label "general-tools-rocky9"
    }
    options {
        timestamps()
        ansiColor('xterm')
        timeout(time: 1, unit: 'HOURS')
    }
    parameters {
        booleanParam(defaultValue: false, description: 'Publish npm package to Nexus registry. Note: Each version must be unique.', name: 'publish')
    }
    environment {
        GL_TOKEN = credentials('GITLAB_TOKEN')
    }
    stages {
        stage('Test') {
            steps {
                sshagent(credentials: ['git_push']) {
                    sh 'git clone --depth=1 ssh://git@git.egnyte-internal.com/integrations/pint-runner-environment.git'
                }

                sh 'cp ./pint-runner-environment/agentic-cli/egnyte-test-config.js ./spec/conf/egnyte-test-config.js'
                sh 'ls -al spec/conf'

                script {
                    sh 'cp /home/packer/.npmrc ./.npmrc'

                    def dockerArgs = [
                        '-v /etc/pki:/etc/pki:ro',
                        '-v /etc/ssl:/etc/ssl:ro'
                    ].join(' ')
                    docker.image("node:24").inside(dockerArgs) {
                        sh 'export NPM_CONFIG_CACHE=$(pwd)/.npm && npm ci'
                        sh 'export NPM_CONFIG_CACHE=$(pwd)/.npm && npm run test'
                    }
                }
            }
        }

        stage('Publish') {
            when {
                anyOf {
                    branch 'master'
                    expression { return params.publish }
                }
            }
            steps {
                runRelease(gitlabProjectId: 6736)
                script {
                    // agentic-cli-binary-release lives on a separate Jenkins controller
                    // (desktop-jenkins, alongside the signing agents), so it cannot be
                    // triggered directly via `build job:` - link to it instead and let a
                    // human click Build, same approach agenticCliBinaryRelease itself uses
                    // to link onward to agentic-cli-sign-and-publish.
                    currentBuild.description = """${currentBuild.description ?: ''} <br />
                    <a href="https://desktop-jenkins.egnyte-internal.com/job/agentic-cli-binary-release/">
                      Build binaries for this release
                    </a>
                    """
                }
            }
        }
    }
    post {
        always {
            cleanWs()
        }
    }
}
